import { z } from 'zod';

/**
 * 错因受控词表。七项，宁可粗也不要散——同一个错误换个说法就统计不到一起。
 *
 * 注意：「蒙对」不在这里。它是答对时的状态，不是错因，由 Attempt.selfConfidence === 1 派生。
 * 塞进 errorTags 会造成"一份数据两个真相源"（见 docs/DECISIONS.md D5）。
 */
export const ErrorTag = z.enum([
  'concept_gap',
  'confusion',
  'misread',
  'forgotten',
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
  time_pressure: '时间不够',
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

/** 答对时不该带错因；答错时错因可以为空（用户还没选） */
export const GradeResultStrict = GradeResult.superRefine((g, ctx) => {
  if (g.correct && g.errorTags.length > 0)
    ctx.addIssue({ code: 'custom', message: '答对时不应该标记错因', path: ['errorTags'] });
});
