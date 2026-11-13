import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { computeKpStats, formatRate, rankWeakKps } from '@knowloop/core';
import type { Question } from '@knowloop/core';
import { db } from '../db';
import { loadKpIndex } from '../db/repo';
import { plainStem, TYPE_LABEL } from '../lib/labels';

export function BankPage() {
  const { bankId } = useParams();
  const bank = useLiveQuery(() => (bankId ? db.banks.get(bankId) : undefined), [bankId]);
  const questions = useLiveQuery(
    () => (bankId ? db.questions.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );
  const kpIndex = useLiveQuery(() => (bankId ? loadKpIndex(bankId) : undefined), [bankId]);
  const attempts = useLiveQuery(
    () => (bankId ? db.attempts.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );
  const kpNodes = useLiveQuery(
    () => (bankId ? db.kpNodes.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );

  const weak = useMemo(() => {
    if (!attempts || !questions || !kpNodes || kpNodes.length === 0) return [];
    return rankWeakKps(computeKpStats({ attempts, questions, kpNodes }), kpNodes, 3);
  }, [attempts, questions, kpNodes]);

  if (bank === undefined || questions === undefined) return <p className="muted">读取中…</p>;
  if (!bank)
    return (
      <div className="empty">
        <h1>题库不存在</h1>
        <Link className="btn" to="/">
          回题库列表
        </Link>
      </div>
    );

  const kpPath = (q: Question) =>
    kpIndex?.get(q.kpIds[0] ?? '')?.path.join(' / ') ?? q.kpIds[0] ?? '';

  // 题目没有显式排序字段（契约里没有），按「知识点路径 → 难度 → id」排，
  // 保证顺序稳定且有意义，而不是被内容哈希打乱。
  const ordered = [...questions].sort(
    (a, b) =>
      kpPath(a).localeCompare(kpPath(b), 'zh-CN') ||
      a.difficulty - b.difficulty ||
      a.id.localeCompare(b.id),
  );

  return (
    <section>
      <nav className="crumbs">
        <Link to="/">题库</Link>
        <span>/</span>
        <span>{bank.name}</span>
      </nav>

      <div className="section-head">
        <h1>{bank.name}</h1>
        <span className="muted">{ordered.length} 道题</span>
      </div>
      {bank.description ? <p className="lede">{bank.description}</p> : null}

      <div className="row-actions">
        <Link className="btn btn-primary" to={`/practice/${bank.id}`}>
          开始练习（随机 {ordered.length} 题）
        </Link>
        <Link className="btn" to={`/review/${bank.id}`}>
          今日复习
        </Link>
        <Link className="btn" to={`/bank/${bank.id}/progress`}>
          诊断
        </Link>
        <Link className="btn" to={`/bank/${bank.id}/mistakes`}>
          错题本
        </Link>
      </div>

      {weak.length > 0 ? (
        <div className="weak-strip">
          <span className="muted">最该补</span>
          {weak.map((item) => (
            <Link key={item.kpId} className="chip" to={`/bank/${bank.id}/progress`}>
              {item.node.name} · {formatRate(item.smoothedRate)}
              <span className="chip-sub">{item.attempts} 次</span>
            </Link>
          ))}
        </div>
      ) : null}

      <ol className="question-list">
        {ordered.map((q, i) => (
          <li key={q.id}>
            <Link to={`/q/${q.id}`} className="question-row">
              <span className="q-index mono">{String(i + 1).padStart(2, '0')}</span>
              <span className={`pill pill-${q.type}`}>{TYPE_LABEL[q.type]}</span>
              <span className="q-stem">{plainStem(q.stem)}</span>
              <span className="q-kp">{kpIndex?.get(q.kpIds[0] ?? '')?.path.at(-1) ?? ''}</span>
              <span className="q-diff mono" title={`难度 ${q.difficulty}/5`}>
                {'●'.repeat(q.difficulty)}
                <span className="dim">{'●'.repeat(5 - q.difficulty)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
