import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { MIN_SAMPLE, computeKpStats, deriveMistakes, formatRate, rankWeakKps } from '@knowloop/core';
import type { KpNode, KpStat } from '@knowloop/core';
import { db } from '../db';

interface TreeRow {
  node: KpNode;
  stat: KpStat | undefined;
  depth: number;
}

function flattenTree(nodes: KpNode[]): TreeRow[] {
  const children = new Map<string | null, KpNode[]>();
  for (const node of nodes) {
    const bucket = children.get(node.parentId) ?? [];
    bucket.push(node);
    children.set(node.parentId, bucket);
  }
  for (const bucket of children.values()) bucket.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));

  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      rows.push({ node, stat: undefined, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function rateClass(rate: number): string {
  if (rate >= 0.6) return 'is-bad';
  if (rate >= 0.35) return 'is-warn';
  return 'is-ok';
}

export function ProgressPage() {
  const { bankId } = useParams();

  const attempts = useLiveQuery(
    () => (bankId ? db.attempts.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );
  const questions = useLiveQuery(
    () => (bankId ? db.questions.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );
  const kpNodes = useLiveQuery(
    () => (bankId ? db.kpNodes.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );

  const stats = useMemo(
    () => (attempts && questions && kpNodes ? computeKpStats({ attempts, questions, kpNodes }) : null),
    [attempts, questions, kpNodes],
  );
  const weak = useMemo(
    () => (stats && kpNodes ? rankWeakKps(stats, kpNodes, 5) : []),
    [stats, kpNodes],
  );
  const mistakes = useMemo(() => (attempts ? deriveMistakes(attempts) : []), [attempts]);

  if (!attempts || !questions || !kpNodes || !stats) return <p className="muted">读取中…</p>;

  const rows = flattenTree(kpNodes);
  const openMistakes = mistakes.filter((m) => !m.resolved).length;
  const answeredQuestions = new Set(attempts.map((a) => a.questionId)).size;

  return (
    <section>
      <nav className="crumbs">
        <Link to="/">题库</Link>
        <span>/</span>
        <Link to={`/bank/${bankId}`}>返回题库</Link>
      </nav>

      <div className="section-head">
        <h1>诊断</h1>
        <span className="muted">
          {attempts.length} 次作答 · 覆盖 {answeredQuestions} 题
        </span>
      </div>

      <ul className="stat-row">
        <li>
          <span className="stat-value">{attempts.length}</span>
          <span className="stat-label">总作答次数</span>
        </li>
        <li>
          <span className="stat-value">{openMistakes}</span>
          <span className="stat-label">未消错</span>
        </li>
        <li>
          <span className="stat-value">{weak.length}</span>
          <span className="stat-label">进榜薄弱项</span>
        </li>
      </ul>

      {attempts.length === 0 ? (
        <div className="empty">
          <h1>还没有作答记录</h1>
          <p className="muted">练一轮之后，这里会告诉你哪个知识点最该补。</p>
          <Link className="btn btn-primary" to={`/practice/${bankId}`}>
            开始练习
          </Link>
        </div>
      ) : (
        <>
          <h2 className="block-title">最该补的 {weak.length} 个知识点</h2>
          {weak.length === 0 ? (
            <p className="muted">
              还没有知识点的作答次数达到 {MIN_SAMPLE} 次，多练几轮再看。
            </p>
          ) : (
            <ol className="weak-list">
              {weak.map((item, i) => (
                <li key={item.kpId} className="weak-row">
                  <span className="weak-rank mono">{i + 1}</span>
                  <span className="weak-name">{item.node.name}</span>
                  <span className="weak-bar">
                    <span
                      className={`weak-bar-fill ${rateClass(item.smoothedRate)}`}
                      style={{ width: `${Math.round(item.smoothedRate * 100)}%` }}
                    />
                  </span>
                  <span className="weak-value mono">{formatRate(item.smoothedRate)}</span>
                  <span className="weak-sample muted">
                    {item.wrong} 错 / {item.attempts} 次
                  </span>
                </li>
              ))}
            </ol>
          )}

          <h2 className="block-title">知识点全景</h2>
          <p className="muted small">
            错误率按作答次数统计，一题挂多个知识点时各计一次；父节点是子节点的累加。
            排序用的是平滑后的值 <code>(错 + 1) / (次数 + 2)</code>，样本少会向 50% 收缩。
          </p>

          <ul className="kp-tree">
            {rows.map(({ node, depth }) => {
              const stat = stats.get(node.id);
              const rate = stat?.smoothedRate ?? 0.5;
              const hasData = (stat?.attempts ?? 0) > 0;
              return (
                <li key={node.id} className="kp-row" style={{ paddingLeft: `${depth * 18}px` }}>
                  <span className="kp-name">{node.name}</span>
                  {hasData ? (
                    <>
                      <span className="weak-bar">
                        <span
                          className={`weak-bar-fill ${rateClass(rate)}`}
                          style={{ width: `${Math.round(rate * 100)}%` }}
                        />
                      </span>
                      <span className="weak-value mono">{formatRate(rate)}</span>
                      <span className="weak-sample muted">
                        {stat?.wrong} 错 / {stat?.attempts} 次
                      </span>
                    </>
                  ) : (
                    <span className="weak-sample muted">暂无作答</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
