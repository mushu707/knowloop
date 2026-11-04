import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';
import { db } from '../db';
import { loadKpIndex } from '../db/repo';
import { Markdown } from '../components/Markdown';
import { ORIGIN_LABEL, TYPE_LABEL } from '../lib/labels';

export function QuestionPage() {
  const { questionId } = useParams();
  const question = useLiveQuery(
    () => (questionId ? db.questions.get(questionId) : undefined),
    [questionId],
  );
  const bankId = question?.bankId;
  const kpIndex = useLiveQuery(() => (bankId ? loadKpIndex(bankId) : undefined), [bankId]);

  if (question === undefined) return <p className="muted">读取中…</p>;
  if (!question)
    return (
      <div className="empty">
        <h1>题目不存在</h1>
        <Link className="btn" to="/">
          回题库列表
        </Link>
      </div>
    );

  const correctIds = new Set<string>();
  if (question.type === 'single') correctIds.add(question.answer.optionId);
  if (question.type === 'multiple') for (const id of question.answer.optionIds) correctIds.add(id);

  const kpPaths = question.kpIds.map((id) => kpIndex?.get(id)?.path.join(' / ') ?? id);

  return (
    <section className="question-detail">
      <nav className="crumbs">
        <Link to="/">题库</Link>
        <span>/</span>
        <Link to={`/bank/${question.bankId}`}>返回列表</Link>
      </nav>

      <div className="q-header">
        <span className={`pill pill-${question.type}`}>{TYPE_LABEL[question.type]}</span>
        <span className="q-diff mono" title={`难度 ${question.difficulty}/5`}>
          {'●'.repeat(question.difficulty)}
          <span className="dim">{'●'.repeat(5 - question.difficulty)}</span>
        </span>
        <span className="muted">{ORIGIN_LABEL[question.origin]}</span>
      </div>

      <Markdown source={question.stem} />

      {question.type === 'boolean' ? (
        <ul className="options">
          {[true, false].map((value) => {
            const isCorrect = question.answer.value === value;
            return (
              <li key={String(value)} className={isCorrect ? 'option is-correct' : 'option'}>
                <span className="option-key mono">{value ? 'T' : 'F'}</span>
                <span className="option-text">{value ? '正确' : '错误'}</span>
                {isCorrect ? <span className="mark">正确答案</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="options">
          {question.options.map((option) => {
            const isCorrect = correctIds.has(option.id);
            return (
              <li key={option.id} className={isCorrect ? 'option is-correct' : 'option'}>
                <span className="option-key mono">{option.id}</span>
                <span className="option-text">{option.text}</span>
                {isCorrect ? <span className="mark">正确答案</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      {question.explanation ? (
        <div className="explain">
          <div className="explain-title">解析</div>
          <Markdown source={question.explanation} />
        </div>
      ) : (
        <p className="muted">这道题还没有解析。</p>
      )}

      <dl className="meta-grid">
        <div>
          <dt>知识点</dt>
          <dd>{kpPaths.join('、')}</dd>
        </div>
        <div>
          <dt>题目 id</dt>
          <dd className="mono">{question.id}</dd>
        </div>
        <div>
          <dt>契约版本</dt>
          <dd className="mono">v{question.schemaVersion}</dd>
        </div>
      </dl>
    </section>
  );
}
