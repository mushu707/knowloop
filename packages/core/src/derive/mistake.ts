import type { Attempt } from '../schema/attempt';
import type { ErrorTag } from '../schema/grade';

export interface MistakeView {
  questionId: string;
  /** 历史答错次数 */
  wrongCount: number;
  lastWrongAt: string;
  lastAnsweredAt: string;
  /** 是否已消错（当前口径：最近一次答对且不是蒙的） */
  resolved: boolean;
  /** 错误次数最高的错因，最多 3 个 */
  topErrorTags: ErrorTag[];
}

/**
 * 蒙对：答对，但自评"没底"。
 *
 * 这个状态不存进 errorTags（那不是错因），而是从 selfConfidence 派生。
 * 一份数据只能有一个真相源 —— 见 docs/DECISIONS.md D5。
 */
export function isLuckyGuess(attempt: Pick<Attempt, 'grade' | 'selfConfidence'>): boolean {
  return attempt.grade.correct && attempt.selfConfidence === 1;
}

function topTags(attempts: Attempt[], limit: number): ErrorTag[] {
  const counts = new Map<ErrorTag, number>();
  for (const a of attempts)
    for (const tag of a.grade.errorTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

/**
 * 错题 = 由 attempts 派生，不落库（D4）。纯函数，可单测。
 *
 * resolved 的口径演进：
 *   S2（现在）：最近一次答对且不是蒙对
 *   S3（接 SM-2 后）：reviewState.repetitions >= 2，那时"连续答对"才有真实时间间隔支撑
 * 所以这里刻意不写死"连续 N 次"，将来只改这一个函数。
 */
export function deriveMistakes(attempts: Attempt[]): MistakeView[] {
  const byQuestion = new Map<string, Attempt[]>();

  for (const attempt of attempts) {
    const bucket = byQuestion.get(attempt.questionId);
    if (bucket) bucket.push(attempt);
    else byQuestion.set(attempt.questionId, [attempt]);
  }

  const views: MistakeView[] = [];

  for (const [questionId, bucket] of byQuestion) {
    const sorted = [...bucket].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
    const wrong = sorted.filter((a) => !a.grade.correct);
    if (wrong.length === 0) continue;

    const last = sorted[sorted.length - 1];
    const lastWrong = wrong[wrong.length - 1];
    if (!last || !lastWrong) continue;

    views.push({
      questionId,
      wrongCount: wrong.length,
      lastWrongAt: lastWrong.answeredAt,
      lastAnsweredAt: last.answeredAt,
      resolved: last.grade.correct && !isLuckyGuess(last),
      topErrorTags: topTags(wrong, 3),
    });
  }

  // 未消错的排前面；同类里错得多的、最近错的排前面
  return views.sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return b.wrongCount - a.wrongCount || b.lastWrongAt.localeCompare(a.lastWrongAt);
  });
}
