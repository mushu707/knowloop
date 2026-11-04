import type { QuestionType } from '@knowloop/core';

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选',
  multiple: '多选',
  boolean: '判断',
};

export const ORIGIN_LABEL: Record<'manual' | 'import' | 'ai', string> = {
  manual: '手动录入',
  import: '外部导入',
  ai: 'AI 生成',
};

/** 列表里只显示题干的第一行散文，跳过代码块、表格与标题标记 */
export function plainStem(stem: string, max = 72): string {
  const prose: string[] = [];
  let inFence = false;
  let codeFirst = false;
  let seenContent = false;

  for (const line of stem.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!seenContent && !inFence) codeFirst = true;
      seenContent = true;
      inFence = !inFence;
      continue;
    }
    if (inFence || trimmed.length === 0) continue;
    seenContent = true;
    if (trimmed.startsWith('|')) continue;
    prose.push(trimmed);
  }

  const first = prose[0] ?? stem.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();

  const cleaned = first
    .replace(/^#+\s*/, '')
    .replace(/^[-*>]\s*/, '')
    .replace(/`+/g, '')
    .replace(/\*\*/g, '');

  // 题干以代码块开头时，剩下的散文脱离上下文看不懂，给一个标记
  const prefix = codeFirst ? '〔代码〕' : '';
  const text = `${prefix}${cleaned.length > 0 ? cleaned : first}`;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('zh-CN');
}
