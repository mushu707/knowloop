import { z } from 'zod';

export const ErrorTag = z.enum([
  'concept_gap',
  'confusion',
  'misread',
  'forgotten',
  'lucky_guess',
  'time_pressure',
  'careless',
  'other',
]);
export type ErrorTag = z.infer<typeof ErrorTag>;

export const ERROR_TAG_LABEL: Record<ErrorTag, string> = {
  concept_gap: '概念不清',
  confusion: '概念混淆',
  misread: '审题失误',
  forgotten: '记忆衰退',
  lucky_guess: '蒙对',
  time_pressure: '时间压力',
  careless: '手滑',
  other: '其他',
};

export const GradeResult = z.object({
  correct: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  errorTags: z.array(ErrorTag).max(3).default([]),
  gradedBy: z.string().min(1),
});
export type GradeResult = z.infer<typeof GradeResult>;

/** correct 为真时只允许 lucky_guess，或不带错因 */
export const GradeResultStrict = GradeResult.superRefine((g, ctx) => {
  if (g.correct && g.errorTags.some((t) => t !== 'lucky_guess'))
    ctx.addIssue({ code: 'custom', message: '答对时只允许标记 lucky_guess', path: ['errorTags'] });
  if (!g.correct && g.errorTags.includes('lucky_guess'))
    ctx.addIssue({ code: 'custom', message: '答错时不能标记 lucky_guess', path: ['errorTags'] });
});
