import type { GradeResult } from '../schema/grade';
import type { ReviewState } from '../schema/review';

/** SM-2 的质量分：0–5，<3 视为未通过 */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5;

const DEFAULT_EF = 2.5;
const MIN_EF = 1.3;
const MAX_EF = 2.8;

/**
 * 把「对/错 + 自评把握」映射成 SM-2 的质量分。
 *
 * 答错一律 1：SM-2 里 0–2 都走重学分支，区分 0/1/2 对调度没有影响，
 * 但会让代码多一层没意义的判断。等 S5 有了更细的错因数据再拆。
 */
export function qualityOf(grade: GradeResult, selfConfidence?: 1 | 2 | 3): Quality {
  if (!grade.correct) return 1;
  if (selfConfidence === 1) return 3;
  if (selfConfidence === 2) return 4;
  return 5;
}

export interface NextReviewInput {
  questionId: string;
  bankId: string;
  grade: GradeResult;
  selfConfidence?: 1 | 2 | 3;
  /** 注入时间，便于测试 */
  now: Date;
}

/**
 * SM-2 单步推进。纯函数：给定旧状态与本次质量分，算出新状态。
 * S2 只写函数不接 UI；S3 的「今日复习队列」由它驱动。
 */
export function nextReviewState(prev: ReviewState | null, input: NextReviewInput): ReviewState {
  const quality = qualityOf(input.grade, input.selfConfidence);
  const passed = quality >= 3;

  const prevEf = prev?.ef ?? DEFAULT_EF;
  const prevInterval = prev?.intervalDays ?? 0;
  const prevReps = prev?.repetitions ?? 0;
  const prevLapses = prev?.lapses ?? 0;

  let intervalDays: number;
  let repetitions: number;

  if (!passed) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions = prevReps + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(prevInterval * prevEf));
  }

  // 先用旧 EF 算间隔，再更新 EF（SM-2 原文顺序）
  const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  const ef = Math.min(MAX_EF, Math.max(MIN_EF, prevEf + delta));

  const dueAt = new Date(input.now.getTime() + intervalDays * 86_400_000);

  return {
    questionId: input.questionId,
    bankId: input.bankId,
    ef,
    intervalDays,
    repetitions,
    lapses: prevLapses + (passed ? 0 : 1),
    dueAt: dueAt.toISOString(),
    lastReviewedAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
  };
}
