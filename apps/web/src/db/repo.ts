import { BankPack, QuestionStrict, lintQuestion, questionContentId } from '@knowloop/core';
import type { KpNode, Question } from '@knowloop/core';
import { db, type BankRow } from './index';

export interface ImportIssue {
  index: number;
  questionId: string;
  reason: string;
}

export interface ImportNotice {
  questionId: string;
  code: string;
  message: string;
}

export interface ImportReport {
  ok: boolean;
  fatal?: string;
  bankId?: string;
  name?: string;
  total: number;
  accepted: number;
  duplicates: number;
  rejected: ImportIssue[];
  rewrittenIds: number;
  notices: ImportNotice[];
  replacedExisting: boolean;
}

const EMPTY = { total: 0, accepted: 0, duplicates: 0, rejected: [], rewrittenIds: 0, notices: [], replacedExisting: false };

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 2)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('；');
}

/**
 * 导入唯一入口。契约见 docs/DATA-CONTRACT.md §4：
 * 结构校验 → 重算内容 id → 去重 → 事务写入。
 */
export async function importPack(raw: unknown): Promise<ImportReport> {
  const parsed = BankPack.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, ...EMPTY, fatal: `不是合法的题库包：${formatIssues(parsed.error)}` };
  }
  const pack = parsed.data;

  // 知识树完整性：父节点必须存在
  const treeIds = new Set(pack.kpTree.map((n: KpNode) => n.id));
  const brokenParent = pack.kpTree.find((n: KpNode) => n.parentId !== null && !treeIds.has(n.parentId));
  if (brokenParent) {
    return {
      ok: false,
      ...EMPTY,
      fatal: `知识树断裂：${brokenParent.name} 的父节点 ${brokenParent.parentId} 不存在`,
    };
  }

  const candidates: Question[] = [];
  const rejected: ImportIssue[] = [];
  const notices: ImportNotice[] = [];
  const seenInBatch = new Set<string>();
  let duplicates = 0;
  let rewrittenIds = 0;

  for (let i = 0; i < pack.questions.length; i += 1) {
    const rawQuestion = pack.questions[i];
    if (!rawQuestion) continue;
    const sourceId = rawQuestion.id;

    const strict = QuestionStrict.safeParse(rawQuestion);
    if (!strict.success) {
      rejected.push({ index: i, questionId: sourceId, reason: formatIssues(strict.error) });
      continue;
    }

    const parsedQuestion = strict.data as Question;
    const knownKpIds = parsedQuestion.kpIds.filter((id) => treeIds.has(id));
    if (knownKpIds.length === 0) {
      rejected.push({ index: i, questionId: sourceId, reason: '题目引用的知识点不在本题库包的知识树中' });
      continue;
    }

    // 不变量 #3：id 必须等于内容哈希，一律重算，不信包里的值
    const id = await questionContentId(parsedQuestion);
    if (id !== sourceId) rewrittenIds += 1;

    if (seenInBatch.has(id)) {
      duplicates += 1;
      continue;
    }
    seenInBatch.add(id);

    const normalized = { ...parsedQuestion, id, bankId: pack.id, kpIds: knownKpIds } as Question;
    candidates.push(normalized);

    for (const notice of lintQuestion(normalized))
      notices.push({ questionId: id, code: notice.code, message: notice.message });
  }

  // 跨题库撞 id：内容相同，保留原记录（避免历史作答变成孤儿）
  const existingRows = await db.questions.bulkGet(candidates.map((q) => q.id));
  const keep: Question[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const question = candidates[i];
    if (!question) continue;
    const existing = existingRows[i];
    if (existing && existing.bankId !== pack.id) {
      duplicates += 1;
      continue;
    }
    keep.push(question);
  }

  const replacedExisting = Boolean(await db.banks.get(pack.id));
  const now = new Date().toISOString();

  const bankRow: BankRow = {
    id: pack.id,
    name: pack.name,
    version: pack.version,
    license: pack.license,
    questionCount: keep.length,
    importedAt: now,
    updatedAt: now,
    ...(pack.author ? { author: pack.author } : {}),
    ...(pack.description ? { description: pack.description } : {}),
  };

  await db.transaction('rw', db.banks, db.kpNodes, db.questions, async () => {
    if (replacedExisting) {
      // 同一题库重新导入 = 替换。attempts 不动（S2 起需要处理孤儿检测）
      await db.questions.where('bankId').equals(pack.id).delete();
      await db.kpNodes.where('bankId').equals(pack.id).delete();
    }
    await db.kpNodes.bulkPut(pack.kpTree.map((n: KpNode) => ({ ...n, bankId: pack.id })));
    await db.questions.bulkPut(keep);
    await db.banks.put(bankRow);
  });

  return {
    ok: true,
    bankId: pack.id,
    name: pack.name,
    total: pack.questions.length,
    accepted: keep.length,
    duplicates,
    rejected,
    rewrittenIds,
    notices,
    replacedExisting,
  };
}

export interface KpIndexEntry {
  node: KpNode;
  path: string[];
  depth: number;
}

/** kpId → 名称路径，用于把「事件循环」显示成「前端面试 / JavaScript / 事件循环」 */
export async function loadKpIndex(bankId: string): Promise<Map<string, KpIndexEntry>> {
  const nodes = await db.kpNodes.where('bankId').equals(bankId).toArray();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new Map<string, KpIndexEntry>();

  for (const node of nodes) {
    const path: string[] = [];
    let cursor: KpNode | undefined = node;
    let guard = 0;
    while (cursor && guard < 16) {
      path.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }
    index.set(node.id, { node, path, depth: path.length - 1 });
  }
  return index;
}
