import { z } from 'zod';
import { Id, Iso, SCHEMA_VERSION } from './common';
import { GradeResult } from './grade';

export const AnswerResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), optionIds: z.array(Id) }),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('skip') }),
]);
export type AnswerResponse = z.infer<typeof AnswerResponse>;

export const Attempt = z.object({
  id: Id,
  questionId: Id,
  bankId: Id,
  sessionId: Id,
  mode: z.enum(['practice', 'review', 'exam']),
  startedAt: Iso,
  answeredAt: Iso,
  durationMs: z.number().int().nonnegative(),
  response: AnswerResponse,
  grade: GradeResult,
  selfConfidence: z.number().int().min(1).max(3).optional(),
  schemaVersion: z.number().int().positive().default(SCHEMA_VERSION),
});
export type Attempt = z.infer<typeof Attempt>;
