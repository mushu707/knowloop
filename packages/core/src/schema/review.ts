import { z } from 'zod';
import { Id, Iso } from './common';

export const ReviewState = z.object({
  questionId: Id,
  bankId: Id,
  ef: z.number().min(1.3).max(2.8),
  intervalDays: z.number().int().nonnegative(),
  repetitions: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  dueAt: Iso,
  lastReviewedAt: Iso.nullable(),
  updatedAt: Iso,
});
export type ReviewState = z.infer<typeof ReviewState>;
