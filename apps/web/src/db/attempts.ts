import { judgeAnswer, nextReviewState } from '@knowloop/core';
import type { AnswerResponse, Attempt, ErrorTag, GradeResult, Question } from '@knowloop/core';
import { db } from './index';

export function newSessionId(): string {
  return `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface RecordAttemptInput {
  question: Question;
  response: AnswerResponse;
  mode: 'practice' | 'review' | 'exam';
  sessionId: string;
  startedAt: string;
  selfConfidence?: 1 | 2 | 3;
  errorTags?: ErrorTag[];
}

/**
 * 作答的唯一写入入口（遵守 STRUCTURE.md 规则二）。
 *
 * 两件事绑定在一个事务里：
 *   ① 往 attempts 追加一条记录（永不 update / delete）
 *   ② 推进 reviewStates（SM-2 算法状态，可重建，所以允许 update）
 *
 * 注意：不能在这个事务里 await 任何非 Dexie 的 Promise，否则事务会被静默提前提交。
 * judgeAnswer / nextReviewState 都是同步纯函数，所以安全。
 */
export async function recordAttempt(input: RecordAttemptInput): Promise<Attempt> {
  const answeredAt = new Date().toISOString();
  const startedAtMs = new Date(input.startedAt).getTime();
  const durationMs = Math.max(0, new Date(answeredAt).getTime() - startedAtMs);

  const judged = judgeAnswer({
    question: input.question,
    response: input.response,
    ...(input.selfConfidence ? { selfConfidence: input.selfConfidence } : {}),
  });

  // 错因是用户看完解析后补的；答对时恒为空（GradeResultStrict 会拦）
  const grade: GradeResult = {
    ...judged,
    errorTags: judged.correct ? [] : (input.errorTags ?? []),
  };

  const attempt: Attempt = {
    id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    questionId: input.question.id,
    bankId: input.question.bankId,
    sessionId: input.sessionId,
    mode: input.mode,
    startedAt: input.startedAt,
    answeredAt,
    durationMs,
    response: input.response,
    grade,
    ...(input.selfConfidence ? { selfConfidence: input.selfConfidence } : {}),
    schemaVersion: 1,
  };

  const now = new Date();
  await db.transaction('rw', db.attempts, db.reviewStates, async () => {
    await db.attempts.add(attempt);

    const prev = (await db.reviewStates.get(input.question.id)) ?? null;
    const next = nextReviewState(prev, {
      questionId: input.question.id,
      bankId: input.question.bankId,
      grade,
      ...(input.selfConfidence ? { selfConfidence: input.selfConfidence } : {}),
      now,
    });
    await db.reviewStates.put(next);
  });

  return attempt;
}

export async function countAttempts(bankId: string): Promise<number> {
  return db.attempts.where('bankId').equals(bankId).count();
}
