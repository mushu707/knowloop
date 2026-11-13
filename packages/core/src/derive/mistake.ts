import type { Attempt } from '../schema/attempt';
import type { ErrorTag } from '../schema/grade';

export interface MistakeView {
  questionId: string;
  /** 历史答错次数 */
  wrongCount: number;
  lastWrongAt: string;
  lastAnsweredAt: string;
  /** 是否已消错：需要「不同自然日的两次答对」 */
  resolved: boolean;
  /** 还差几次「隔天答对」才算消错，0 表示已消 */
  remainingToResolve: 0 | 1 | 2;
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

/** 真正的答对：答对且不是蒙的。蒙对既不计入连击，也会打断连击 */
function isSolidCorrect(attempt: Attempt): boolean {
  return attempt.grade.correct && !isLuckyGuess(attempt);
}

/**
 * 本地自然日。「隔天」对用户来说是日历概念，不是 UTC 的 24 小时，
 * 所以这里用运行时本地时区。跨时区迁移会让判定变化——这比
 * 「昨晚和今早的两次答对被算成同一天」要好。
 */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function topTags(attempts: Attempt[], limit: number): ErrorTag[] {
  const counts = new Map<ErrorTag, number>();
  for (const a of attempts) for (const tag of a.grade.errorTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

/**
 * 错题 = 由 attempts 派生，不落库（D4）。纯函数，可单测。
 *
 * resolved 的口径（S3 起）：
 *   尾部连续「真答对」≥ 2 次，且最后两次不在同一自然日。
 *
 * 为什么不用 reviewState.repetitions >= 2：那会让"错题"同时依赖 attempts 和
 * reviewStates 两个源，D4 的整条论证就破了。而且 repetitions 可以被同一 session
 * 连刷两遍刷出来，"隔天再答对"不能。
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

    const lastWrong = wrong[wrong.length - 1];
    if (!lastWrong) continue;

    // 从尾部往前数连续的「真答对」
    const tail: Attempt[] = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const attempt = sorted[i];
      if (!attempt || !isSolidCorrect(attempt)) break;
      tail.unshift(attempt);
    }

    let resolved = false;
    let remainingToResolve: 0 | 1 | 2 = 2;

    if (tail.length === 0) remainingToResolve = 2;
    else if (tail.length === 1) remainingToResolve = 1;
    else {
      const newest = tail[tail.length - 1];
      const previous = tail[tail.length - 2];
      if (newest && previous && localDayKey(newest.answeredAt) !== localDayKey(previous.answeredAt)) {
        resolved = true;
        remainingToResolve = 0;
      } else {
        remainingToResolve = 1;
      }
    }

    views.push({
      questionId,
      wrongCount: wrong.length,
      lastWrongAt: lastWrong.answeredAt,
      lastAnsweredAt: sorted[sorted.length - 1]?.answeredAt ?? lastWrong.answeredAt,
      resolved,
      remainingToResolve,
      topErrorTags: topTags(wrong, 3),
    });
  }

  // 未消错的排前面；同类里错得多的、最近错的排前面
  return views.sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return b.wrongCount - a.wrongCount || b.lastWrongAt.localeCompare(a.lastWrongAt);
  });
}
