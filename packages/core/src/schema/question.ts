import { z } from 'zod';
import { Id, Iso, SCHEMA_VERSION } from './common';

export const QuestionType = z.enum(['single', 'multiple', 'boolean']);
export type QuestionType = z.infer<typeof QuestionType>;

export const Option = z.object({
  id: Id,
  text: z.string().min(1),
});
export type Option = z.infer<typeof Option>;

export const SourceRef = z.object({
  docId: Id,
  chunkIds: z.array(Id).min(1),
  page: z.number().int().positive().optional(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

const QuestionBase = z.object({
  id: Id,
  bankId: Id,
  stem: z.string().min(4).max(2000),
  explanation: z.string().max(4000).optional(),
  kpIds: z.array(Id).min(1).max(6),
  difficulty: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().min(1).max(24)).max(12).default([]),
  source: SourceRef.optional(),
  origin: z.enum(['manual', 'import', 'ai']),
  extensions: z.record(z.string(), z.unknown()).default({}),
  createdAt: Iso,
  updatedAt: Iso,
  schemaVersion: z.number().int().positive().default(SCHEMA_VERSION),
});

export const Question = z.discriminatedUnion('type', [
  QuestionBase.extend({
    type: z.literal('single'),
    options: z.array(Option).min(2).max(8),
    answer: z.object({ optionId: Id }),
  }),
  QuestionBase.extend({
    type: z.literal('multiple'),
    options: z.array(Option).min(2).max(8),
    answer: z.object({ optionIds: z.array(Id).min(2) }),
  }),
  QuestionBase.extend({
    type: z.literal('boolean'),
    answer: z.object({ value: z.boolean() }),
  }),
]);

export type Question = z.infer<typeof Question>;
export type SingleQuestion = Extract<Question, { type: 'single' }>;
export type MultipleQuestion = Extract<Question, { type: 'multiple' }>;
export type BooleanQuestion = Extract<Question, { type: 'boolean' }>;

/** 跨字段校验：Zod 不会替你做答案与选项的一致性检查 */
export const QuestionStrict = Question.superRefine((q, ctx) => {
  if (q.type === 'single') {
    if (!q.options.some((o) => o.id === q.answer.optionId))
      ctx.addIssue({ code: 'custom', message: 'answer.optionId 不在 options 中', path: ['answer'] });
  }

  if (q.type === 'multiple') {
    const ids = new Set(q.options.map((o) => o.id));
    for (const a of q.answer.optionIds)
      if (!ids.has(a)) ctx.addIssue({ code: 'custom', message: `answer 含未知选项: ${a}`, path: ['answer'] });
    if (new Set(q.answer.optionIds).size !== q.answer.optionIds.length)
      ctx.addIssue({ code: 'custom', message: 'answer.optionIds 有重复', path: ['answer'] });
  }

  if (q.type !== 'boolean') {
    const ids = new Set(q.options.map((o) => o.id));
    if (ids.size !== q.options.length)
      ctx.addIssue({ code: 'custom', message: 'options.id 有重复', path: ['options'] });
  }

  if (new Set(q.kpIds).size !== q.kpIds.length)
    ctx.addIssue({ code: 'custom', message: 'kpIds 有重复', path: ['kpIds'] });

  if (q.origin === 'ai' && !q.source)
    ctx.addIssue({ code: 'custom', message: 'AI 生成的题必须带 source', path: ['source'] });
});
