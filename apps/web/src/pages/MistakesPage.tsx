import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { ERROR_TAG_LABEL, deriveMistakes } from '@knowloop/core';
import { db } from '../db';
import { plainStem, TYPE_LABEL } from '../lib/labels';

export function MistakesPage() {
  const { bankId } = useParams();
  const [showResolved, setShowResolved] = useState(false);

  const attempts = useLiveQuery(
    () => (bankId ? db.attempts.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );
  const questions = useLiveQuery(
    () => (bankId ? db.questions.where('bankId').equals(bankId).toArray() : []),
    [bankId],
  );

  const views = useMemo(() => (attempts ? deriveMistakes(attempts) : []), [attempts]);
  const byId = useMemo(() => new Map((questions ?? []).map((q) => [q.id, q])), [questions]);

  if (!attempts || !questions) return <p className="muted">读取中…</p>;

  const open = views.filter((v) => !v.resolved);
  const resolved = views.filter((v) => v.resolved);
  const visible = showResolved ? views : open;

  return (
    <section>
      <nav className="crumbs">
        <Link to="/">题库</Link>
        <span>/</span>
        <Link to={`/bank/${bankId}`}>返回题库</Link>
      </nav>

      <div className="section-head">
        <h1>错题本</h1>
        <span className="muted">
          未消错 {open.length} · 已消错 {resolved.length}
        </span>
      </div>

      <p className="lede">
        错题不单独存表，而是从作答记录实时推导（{attempts.length} 条记录）。答对一次不算消错——
        <strong>蒙对不算</strong>。
      </p>

      {resolved.length > 0 ? (
        <label className="toggle">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          显示已消错的 {resolved.length} 道
        </label>
      ) : null}

      {visible.length === 0 ? (
        <div className="empty">
          <h1>{views.length === 0 ? '还没有错题' : '都消掉了'}</h1>
          <p className="muted">
            {views.length === 0 ? '去练一轮，答错的题会自动出现在这里。' : '这一轮很干净。'}
          </p>
          <Link className="btn btn-primary" to={`/practice/${bankId}`}>
            开始练习
          </Link>
        </div>
      ) : (
        <ol className="mistake-list">
          {visible.map((view) => {
            const question = byId.get(view.questionId);
            return (
              <li key={view.questionId} className={view.resolved ? 'mistake-row is-resolved' : 'mistake-row'}>
                <div className="mistake-main">
                  <div className="mistake-meta">
                    <span className={`pill pill-${question?.type ?? 'single'}`}>
                      {question ? TYPE_LABEL[question.type] : '未知'}
                    </span>
                    <span className="muted mono">错 {view.wrongCount} 次</span>
                    {view.resolved ? <span className="badge badge-ok">已消错</span> : null}
                  </div>
                  <div className="mistake-stem">{question ? plainStem(question.stem, 96) : view.questionId}</div>
                  {view.topErrorTags.length > 0 ? (
                    <div className="chips chips-sm">
                      {view.topErrorTags.map((tag) => (
                        <span key={tag} className="chip is-static">
                          {ERROR_TAG_LABEL[tag]}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Link className="btn btn-sm" to={`/practice/${bankId}?only=${view.questionId}`}>
                  再练一次
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
