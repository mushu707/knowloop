import type { Question } from '../schema/question';

/**
 * 质量提示，不是结构校验。
 * zod 管「能不能存」，这里管「该不该存」——两者混在一起会让导入变成非黑即白。
 */
export interface LintNotice {
  code: 'all-options-correct' | 'duplicate-option-text' | 'no-explanation' | 'stem-looks-truncated';
  message: string;
}

export function lintQuestion(q: Question): LintNotice[] {
  const notices: LintNotice[] = [];

  if (q.type === 'multiple' && q.answer.optionIds.length === q.options.length)
    notices.push({
      code: 'all-options-correct',
      message: '所有选项都正确，实质是判断题；建议改成 boolean 或补一个错误选项',
    });

  if (q.type !== 'boolean') {
    const seen = new Set<string>();
    for (const o of q.options) {
      const key = o.text.trim();
      if (seen.has(key)) {
        notices.push({ code: 'duplicate-option-text', message: `选项文本重复：${key}` });
        break;
      }
      seen.add(key);
    }
  }

  if (!q.explanation && q.origin === 'ai')
    notices.push({ code: 'no-explanation', message: 'AI 生成的题缺少解析' });

  if (q.stem.trim().length < 8 && q.type !== 'boolean')
    notices.push({ code: 'stem-looks-truncated', message: '题干过短，可能被截断' });

  return notices;
}
