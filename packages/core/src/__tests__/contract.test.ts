import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BankPack,
  GradeResultStrict,
  QuestionStrict,
  normalizeText,
  questionContentId,
  sortKeysDeep,
} from '../index';

const packRaw = JSON.parse(
  readFileSync(new URL('../../../../fixtures/questions.seed.json', import.meta.url), 'utf8'),
) as unknown;

describe('canonical 化', () => {
  it('统一换行并逐行压缩空白', () => {
    expect(normalizeText('a\r\nb\t\tc  d\n\n\n\nend')).toBe('a\nb c d\n\nend');
  });

  it('保留代码块的行结构（不被拍平成一行）', () => {
    const stem = '看代码：\n```js\nconst a = 1\n  const b = 2\n```';
    expect(normalizeText(stem).split('\n')).toHaveLength(5);
  });

  it('key 排序与插入顺序无关', () => {
    expect(JSON.stringify(sortKeysDeep({ b: 1, a: { d: 2, c: 3 } }))).toBe(
      JSON.stringify(sortKeysDeep({ a: { c: 3, d: 2 }, b: 1 })),
    );
  });

  it('空白差异不影响内容 id', async () => {
    const a = { type: 'boolean' as const, stem: '  一个  命题 ', answer: { value: true } };
    const b = { type: 'boolean' as const, stem: '一个 命题', answer: { value: true } };
    expect(await questionContentId(a)).toBe(await questionContentId(b));
  });

  it('内容改变则 id 改变', async () => {
    const a = { type: 'boolean' as const, stem: '命题 A', answer: { value: true } };
    const b = { type: 'boolean' as const, stem: '命题 B', answer: { value: true } };
    expect(await questionContentId(a)).not.toBe(await questionContentId(b));
  });
});

describe('fixture 与契约一致', () => {
  it('题库包能通过 BankPack 校验', () => {
    const result = BankPack.safeParse(packRaw);
    if (!result.success) console.error(result.error.issues.slice(0, 3));
    expect(result.success).toBe(true);
  });

  it('每一道题都通过 QuestionStrict', () => {
    const pack = BankPack.parse(packRaw);
    for (const q of pack.questions) {
      const r = QuestionStrict.safeParse(q);
      if (!r.success) console.error(q.id, r.error.issues);
      expect(r.success, q.id).toBe(true);
    }
  });

  it('题目 id 等于重算的内容哈希（不变量 #3）', async () => {
    const pack = BankPack.parse(packRaw);
    for (const q of pack.questions) {
      expect(await questionContentId(q), q.id).toBe(q.id);
    }
  });

  it('题目 id 无重复', () => {
    const pack = BankPack.parse(packRaw);
    expect(new Set(pack.questions.map((q) => q.id)).size).toBe(pack.questions.length);
  });
});

describe('QuestionStrict 拒绝畸形题', () => {
  const base = {
    id: 'q_x',
    bankId: 'b_x',
    stem: '这是一道用于校验的题目',
    kpIds: ['kp_x'],
    origin: 'manual' as const,
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
  };

  it('单选答案指向不存在的选项', () => {
    const r = QuestionStrict.safeParse({
      ...base,
      type: 'single',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      answer: { optionId: 'z' },
    });
    expect(r.success).toBe(false);
  });

  it('多选答案重复', () => {
    const r = QuestionStrict.safeParse({
      ...base,
      type: 'multiple',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      answer: { optionIds: ['a', 'a'] },
    });
    expect(r.success).toBe(false);
  });

  it('AI 生成的题必须带 source', () => {
    const r = QuestionStrict.safeParse({
      ...base,
      origin: 'ai',
      type: 'boolean',
      answer: { value: true },
    });
    expect(r.success).toBe(false);
  });

  it('判断题型不需要 options', () => {
    const r = QuestionStrict.safeParse({ ...base, type: 'boolean', answer: { value: false } });
    expect(r.success).toBe(true);
  });
});

describe('GradeResultStrict', () => {
  it('答对时不能标记概念混淆', () => {
    const r = GradeResultStrict.safeParse({
      correct: true,
      errorTags: ['confusion'],
      gradedBy: 'core',
    });
    expect(r.success).toBe(false);
  });

  it('答对时不允许带任何错因（蒙对改由 selfConfidence 派生）', () => {
    const r = GradeResultStrict.safeParse({
      correct: true,
      errorTags: ['confusion'],
      gradedBy: 'core',
    });
    expect(r.success).toBe(false);
  });

  it('答对且无错因是合法的', () => {
    const r = GradeResultStrict.safeParse({
      correct: true,
      errorTags: [],
      gradedBy: 'core',
    });
    expect(r.success).toBe(true);
  });
});
