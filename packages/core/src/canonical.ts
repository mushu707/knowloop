/**
 * 题目内容哈希。规则见 docs/DATA-CONTRACT.md §1。
 * 可执行参考实现：scripts/gen-fixture.mjs（两者必须一致）。
 */

export type QuestionContent =
  | { type: 'single'; stem: string; options: { text: string }[]; answer: { optionId: string } }
  | { type: 'multiple'; stem: string; options: { text: string }[]; answer: { optionIds: string[] } }
  | { type: 'boolean'; stem: string; answer: { value: boolean } };

/** 统一换行 → 逐行 trim + 行内空白压缩 → 折叠多余空行 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sortKeysDeep(v)) as unknown as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeysDeep((value as Record<string, unknown>)[k])]),
    ) as T;
  return value;
}

export function questionPayload(q: QuestionContent): unknown {
  if (q.type === 'boolean')
    return sortKeysDeep({ type: q.type, stem: normalizeText(q.stem), options: null, answer: q.answer });

  return sortKeysDeep({
    type: q.type,
    stem: normalizeText(q.stem),
    options: q.options.map((o) => ({ text: normalizeText(o.text) })),
    answer: q.answer,
  });
}

async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('crypto.subtle 不可用：需要 https 或 localhost 环境');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256HexUtf8(input: string): Promise<string> {
  return sha256Hex(input);
}

export async function questionContentId(q: QuestionContent): Promise<string> {
  return `q_${(await sha256Hex(JSON.stringify(questionPayload(q)))).slice(0, 16)}`;
}

export async function packChecksum(input: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(sortKeysDeep(input)));
}
