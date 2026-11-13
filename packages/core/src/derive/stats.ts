import type { Attempt } from '../schema/attempt';
import type { KpNode } from '../schema/kp';
import type { Question } from '../schema/question';

/** 进榜门槛：少于这个作答次数不参与薄弱排序（噪声） */
export const MIN_SAMPLE = 3;

/** 平滑强度：相当于 Beta(1,1) 先验，即把结果向 50% 收缩 */
const ALPHA = 1;

export interface KpStat {
  kpId: string;
  /** 该节点及其所有子节点上的作答次数 */
  attempts: number;
  wrong: number;
  /** 原始错误率，等于 wrong / attempts */
  rawRate: number;
  /** 平滑后的错误率，用于排序 */
  smoothedRate: number;
  /** 样本量是否够进榜 */
  eligible: boolean;
  depth: number;
}

export interface KpStatInput {
  attempts: Attempt[];
  questions: Question[];
  kpNodes: KpNode[];
}

/**
 * 知识点错误率统计。
 *
 * 口径（契约 §7，写死不许各页面自己算）：
 *   - 分母是「作答次数」，不是题目数
 *   - 一题挂多个知识点时，对每个知识点各计一次（不做 1/N 分摊）
 *   - 父节点 = 子节点分子分母分别累加（不是比率的平均）
 *
 * 排序用平滑值而非原始值：做过 1 次错 1 次 = 100% 会排第一，
 * 噪声主导排序。平滑 (wrong+1)/(attempts+2) 让少样本向 50% 收缩。
 */
export function computeKpStats({ attempts, questions, kpNodes }: KpStatInput): Map<string, KpStat> {
  const kpIdsByQuestion = new Map<string, string[]>();
  for (const q of questions) kpIdsByQuestion.set(q.id, q.kpIds);

  const nodeById = new Map(kpNodes.map((n) => [n.id, n]));

  // kpId → [自身, 父, 祖父...]
  const chainCache = new Map<string, string[]>();
  const chainOf = (kpId: string): string[] => {
    const cached = chainCache.get(kpId);
    if (cached) return cached;

    const chain: string[] = [];
    let cursor: string | null | undefined = kpId;
    let guard = 0;
    while (cursor && guard < 16) {
      chain.push(cursor);
      cursor = nodeById.get(cursor)?.parentId ?? null;
      guard += 1;
    }
    chainCache.set(kpId, chain);
    return chain;
  };

  const totals = new Map<string, { attempts: number; wrong: number }>();
  const bump = (kpId: string, correct: boolean) => {
    const row = totals.get(kpId) ?? { attempts: 0, wrong: 0 };
    row.attempts += 1;
    if (!correct) row.wrong += 1;
    totals.set(kpId, row);
  };

  for (const attempt of attempts) {
    const kpIds = kpIdsByQuestion.get(attempt.questionId);
    if (!kpIds) continue;
    for (const kpId of kpIds) for (const nodeId of chainOf(kpId)) bump(nodeId, attempt.grade.correct);
  }

  const stats = new Map<string, KpStat>();
  for (const node of kpNodes) {
    const row = totals.get(node.id) ?? { attempts: 0, wrong: 0 };
    const smoothedRate = (row.wrong + ALPHA) / (row.attempts + 2 * ALPHA);
    stats.set(node.id, {
      kpId: node.id,
      attempts: row.attempts,
      wrong: row.wrong,
      rawRate: row.attempts === 0 ? 0 : row.wrong / row.attempts,
      smoothedRate,
      eligible: row.attempts >= MIN_SAMPLE,
      depth: chainOf(node.id).length - 1,
    });
  }

  return stats;
}

export interface RankedKp extends KpStat {
  node: KpNode;
}

/**
 * 薄弱知识点排序：只取**叶子节点**中够样本的，平滑错误率降序；同分时作答多的优先。
 *
 * 为什么排除父节点：父节点的数字是所有子节点的累加，让它进榜会和自己的子节点重复
 * （「JavaScript 55%」和「事件循环 80%」同时出现），而"去练 JavaScript"这个动作
 * 对用户没有意义。父节点的数字仍然算，只是留在诊断页的树里看。
 */
export function rankWeakKps(stats: Map<string, KpStat>, kpNodes: KpNode[], limit = 5): RankedKp[] {
  const nodeById = new Map(kpNodes.map((n) => [n.id, n]));
  const parentIds = new Set(kpNodes.flatMap((n) => (n.parentId ? [n.parentId] : [])));

  return [...stats.values()]
    .filter((s) => s.eligible && s.wrong > 0 && !parentIds.has(s.kpId))
    .sort((a, b) => b.smoothedRate - a.smoothedRate || b.attempts - a.attempts || a.kpId.localeCompare(b.kpId))
    .slice(0, limit)
    .flatMap((s) => {
      const node = nodeById.get(s.kpId);
      return node ? [{ ...s, node }] : [];
    });
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
