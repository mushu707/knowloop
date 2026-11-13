import type { Question } from '../schema/question';
import type { ReviewState } from '../schema/review';

export interface QueueLimits {
  /** 每日题量上限。没有上限，一次积压就劝退 */
  dailyMax: number;
  /** 新题占比，其余留给到期复习 */
  newRatio: number;
}

export const DEFAULT_QUEUE_LIMITS: QueueLimits = { dailyMax: 20, newRatio: 0.3 };

export type QueueKind = 'new' | 'review';

export interface QueueItem {
  questionId: string;
  kind: QueueKind;
}

export interface TodayQueue {
  items: QueueItem[];
  /** 到期的总题数（截断前） */
  dueTotal: number;
  /** 从未做过的总题数 */
  newTotal: number;
  reviewCount: number;
  newCount: number;
  /** 有题被上限挡在外面 */
  truncated: boolean;
}

/**
 * 今日队列 = 到期复习 + 新题配额（Anki 范式）。
 *
 * 为什么不是"只取到期题"：刚导入题库时所有题都没有复习状态，
 * 队列会是空的 —— 第一天没人能用。
 * 为什么不提前拉未到期的题：那会污染 SM-2 的间隔设计。
 */
export function buildTodayQueue(input: {
  questions: Question[];
  reviewStates: ReviewState[];
  now: Date;
  limits?: QueueLimits;
}): TodayQueue {
  const { questions, reviewStates, now } = input;
  const limits = input.limits ?? DEFAULT_QUEUE_LIMITS;
  const nowIso = now.toISOString();

  const stateByQuestion = new Map(reviewStates.map((s) => [s.questionId, s]));

  const due = questions
    .flatMap((q) => {
      const state = stateByQuestion.get(q.id);
      if (!state) return [];
      // repetitions === 0 表示「还没学会」（答错过、还没重新答对），
      // 不管 SM-2 把 dueAt 排到哪天，它都该立刻回到队列。
      // 否则刚练完一轮全是错题时，今日复习会显示为空。
      const isDue = state.repetitions === 0 || state.dueAt <= nowIso;
      if (!isDue) return [];
      return [{ question: q, dueAt: state.repetitions === 0 ? '' : state.dueAt }];
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.question.id.localeCompare(b.question.id));

  const fresh = questions
    .filter((q) => !stateByQuestion.has(q.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const dailyMax = Math.max(0, Math.floor(limits.dailyMax));
  const newQuota = Math.min(dailyMax, Math.round(dailyMax * Math.min(1, Math.max(0, limits.newRatio))));
  const reviewQuota = dailyMax - newQuota;

  let reviewTake = due.slice(0, reviewQuota);
  let newTake = fresh.slice(0, newQuota);

  // 一侧不够就用另一侧补满，避免"今天只有 2 道题"的空转
  let spare = dailyMax - reviewTake.length - newTake.length;
  if (spare > 0 && fresh.length > newTake.length) {
    newTake = fresh.slice(0, newTake.length + spare);
    spare = dailyMax - reviewTake.length - newTake.length;
  }
  if (spare > 0 && due.length > reviewTake.length) {
    reviewTake = due.slice(0, reviewTake.length + spare);
  }

  return {
    items: [
      ...reviewTake.map(({ question }) => ({ questionId: question.id, kind: 'review' as const })),
      ...newTake.map((question) => ({ questionId: question.id, kind: 'new' as const })),
    ],
    dueTotal: due.length,
    newTotal: fresh.length,
    reviewCount: reviewTake.length,
    newCount: newTake.length,
    truncated: due.length > reviewTake.length || fresh.length > newTake.length,
  };
}
