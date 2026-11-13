import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ERROR_TAG_LABEL, buildTodayQueue, isAnswerCorrect } from '@knowloop/core';
import type { AnswerResponse, ErrorTag, Question } from '@knowloop/core';
import { db } from '../db';
import { newSessionId, recordAttempt } from '../db/attempts';
import { Markdown } from '../components/Markdown';
import { TYPE_LABEL } from '../lib/labels';

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (a !== undefined && b !== undefined) {
      copy[i] = b;
      copy[j] = a;
    }
  }
  return copy;
}

const TAG_ORDER: ErrorTag[] = [
  'concept_gap',
  'confusion',
  'misread',
  'forgotten',
  'time_pressure',
  'careless',
  'other',
];

export function PracticePage({ mode = 'practice' }: { mode?: 'practice' | 'review' }) {
  const { bankId } = useParams();
  const [search] = useSearchParams();
  const onlyId = search.get('only');

  const [queue, setQueue] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [boolPicked, setBoolPicked] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<'answering' | 'revealed'>('answering');
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [errorTags, setErrorTags] = useState<ErrorTag[]>([]);
  const [selfConfidence, setSelfConfidence] = useState<1 | 2 | 3 | undefined>(undefined);
  const [results, setResults] = useState<{ correct: boolean }[]>([]);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewMeta, setReviewMeta] = useState<{ reviewCount: number; newCount: number; truncated: boolean } | null>(
    null,
  );

  const sessionId = useRef(newSessionId());
  const startedAt = useRef(new Date().toISOString());

  // 队列的身份：题库 + 单题 + 模式。任一变化都意味着「这是一次新的练习」。
  // 不能用一次性的 boolean ref 挡 StrictMode —— 那样在 /review → /practice?only=x
  // 之间切换时，组件被复用、队列却还是上一轮的（S3 验收抓到的真 bug）。
  const signature = `${bankId ?? ''}|${onlyId ?? ''}|${mode}`;
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (loadedFor.current === signature) return;
    loadedFor.current = signature;

    setQueue(null);
    setIndex(0);
    setPicked([]);
    setBoolPicked(null);
    setPhase('answering');
    setVerdict(null);
    setErrorTags([]);
    setSelfConfidence(undefined);
    setResults([]);
    setFinished(false);
    setReviewMeta(null);
    sessionId.current = newSessionId();
    startedAt.current = new Date().toISOString();

    void (async () => {
      if (!bankId) return;
      const all = await db.questions.where('bankId').equals(bankId).toArray();

      if (onlyId) {
        setQueue(all.filter((q) => q.id === onlyId));
      } else if (mode === 'review') {
        // 队列口径见 core/derive/queue.ts：到期复习优先，剩余名额补新题，有每日上限
        const states = await db.reviewStates.where('bankId').equals(bankId).toArray();
        const today = buildTodayQueue({ questions: all, reviewStates: states, now: new Date() });
        const byId = new Map(all.map((q) => [q.id, q]));
        setQueue(
          today.items.flatMap((item) => {
            const q = byId.get(item.questionId);
            return q ? [q] : [];
          }),
        );
        setReviewMeta({
          reviewCount: today.reviewCount,
          newCount: today.newCount,
          truncated: today.truncated,
        });
      } else {
        setQueue(shuffle(all));
      }

    })();
  }, [signature, bankId, onlyId, mode]);

  const question = queue?.[index];

  const response = useMemo<AnswerResponse | null>(() => {
    if (!question) return null;
    if (question.type === 'boolean') return boolPicked === null ? null : { kind: 'boolean', value: boolPicked };
    if (picked.length === 0) return null;
    if (question.type === 'single' && picked.length !== 1) return null;
    return { kind: 'choice', optionIds: picked };
  }, [question, picked, boolPicked]);

  const pickOption = useCallback(
    (optionId: string) => {
      if (phase !== 'answering' || !question) return;
      if (question.type === 'single') setPicked([optionId]);
      else
        setPicked((prev) =>
          prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
        );
    },
    [phase, question],
  );

  const submit = useCallback(() => {
    if (!question || !response || phase !== 'answering') return;
    setVerdict(isAnswerCorrect(question, response));
    setPhase('revealed');
  }, [question, response, phase]);

  const next = useCallback(async () => {
    if (!question || verdict === null || !response || busy) return;
    setBusy(true);

    try {
      await recordAttempt({
        question,
        response,
        mode,
        sessionId: sessionId.current,
        startedAt: startedAt.current,
        ...(selfConfidence ? { selfConfidence } : {}),
        ...(verdict ? {} : { errorTags }),
      });
    } finally {
      setBusy(false);
    }

    setResults((prev) => [...prev, { correct: verdict }]);

    if (queue && index + 1 >= queue.length) {
      setFinished(true);
      return;
    }

    setIndex((i) => i + 1);
    setPicked([]);
    setBoolPicked(null);
    setPhase('answering');
    setVerdict(null);
    setErrorTags([]);
    setSelfConfidence(undefined);
    startedAt.current = new Date().toISOString();
  }, [question, verdict, response, busy, selfConfidence, errorTags, queue, index]);

  // 键盘：1-9 选选项，Enter 提交 / 下一题，→ 下一题
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (phase === 'answering') {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
          return;
        }
        const digit = Number(event.key);
        if (!Number.isInteger(digit) || digit < 1) return;
        if (!question) return;
        if (question.type === 'boolean') {
          if (digit === 1) setBoolPicked(true);
          if (digit === 2) setBoolPicked(false);
          return;
        }
        const option = question.options[digit - 1];
        if (option) pickOption(option.id);
        return;
      }

      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        void next();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, question, submit, next, pickOption]);

  if (!queue) return <p className="muted">准备题目…</p>;

  if (queue.length === 0)
    return (
      <div className="empty">
        <h1>{mode === 'review' ? '今天没有要复习的题' : '这个题库里没有可练的题'}</h1>
        <p className="muted">
          {mode === 'review' ? '所有做过的题都还没到复习时间，明天再来。' : '先去导入题库。'}
        </p>
        <Link className="btn" to={`/bank/${bankId}`}>
          回题库
        </Link>
      </div>
    );

  if (finished) {
    const correct = results.filter((r) => r.correct).length;
    const total = results.length;
    const rate = total === 0 ? 0 : Math.round((correct / total) * 100);
    return (
      <section className="summary">
        <h1>本轮结束</h1>
        <ul className="stat-row">
          <li>
            <span className="stat-value">{correct}</span>
            <span className="stat-label">答对</span>
          </li>
          <li>
            <span className="stat-value">{total - correct}</span>
            <span className="stat-label">答错</span>
          </li>
          <li>
            <span className="stat-value">{rate}%</span>
            <span className="stat-label">正确率</span>
          </li>
        </ul>
        <div className="row-actions">
          <Link
            className="btn btn-primary"
            to={mode === 'review' ? `/review/${bankId}` : `/practice/${bankId}`}
            reloadDocument
          >
            再练一轮
          </Link>
          <Link className="btn" to={`/bank/${bankId}/mistakes`}>
            看错题本
          </Link>
          <Link className="btn" to={`/bank/${bankId}`}>
            回题库
          </Link>
        </div>
      </section>
    );
  }

  if (!question)
    return (
      <div className="empty">
        <h1>题目不存在</h1>
        <Link className="btn" to={`/bank/${bankId}`}>
          回题库
        </Link>
      </div>
    );

  const correctIds = new Set<string>();
  if (question.type === 'single') correctIds.add(question.answer.optionId);
  if (question.type === 'multiple') for (const id of question.answer.optionIds) correctIds.add(id);

  const revealed = phase === 'revealed';
  const total = queue.length;

  return (
    <section className="practice" data-question-id={question.id} data-phase={phase}>
      <div className="practice-head">
        <Link className="muted" to={`/bank/${bankId}`}>
          ← 退出
        </Link>
        {reviewMeta ? (
          <span className="muted">
            复习 {reviewMeta.reviewCount} · 新题 {reviewMeta.newCount}
            {reviewMeta.truncated ? '（还有题排到明天）' : ''}
          </span>
        ) : null}
        <span className="mono muted">
          {index + 1} / {total}
        </span>
      </div>
      <div className="progress">
        <div className="progress-fill" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <div className="q-header">
        <span className={`pill pill-${question.type}`}>{TYPE_LABEL[question.type]}</span>
        <span className="q-diff mono" title={`难度 ${question.difficulty}/5`}>
          {'●'.repeat(question.difficulty)}
          <span className="dim">{'●'.repeat(5 - question.difficulty)}</span>
        </span>
      </div>

      <Markdown source={question.stem} />

      {question.type === 'boolean' ? (
        <ul className="options">
          {[true, false].map((value, i) => {
            const selected = boolPicked === value;
            const isCorrect = revealed && question.answer.value === value;
            return (
              <li key={String(value)}>
                <button
                  type="button"
                  className={`option option-btn${selected ? ' is-selected' : ''}${isCorrect ? ' is-correct' : ''}`}
                  onClick={() => phase === 'answering' && setBoolPicked(value)}
                  disabled={revealed}
                >
                  <span className="option-key mono">{i + 1}</span>
                  <span className="option-text">{value ? '正确' : '错误'}</span>
                  {isCorrect ? <span className="mark">正确答案</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="options">
          {question.options.map((option, i) => {
            const selected = picked.includes(option.id);
            const isCorrect = revealed && correctIds.has(option.id);
            const isWrongPick = revealed && selected && !correctIds.has(option.id);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className={`option option-btn${selected ? ' is-selected' : ''}${isCorrect ? ' is-correct' : ''}${isWrongPick ? ' is-wrong' : ''}`}
                  onClick={() => pickOption(option.id)}
                  disabled={revealed}
                >
                  <span className="option-key mono">{i + 1}</span>
                  <span className="option-text">{option.text}</span>
                  {isCorrect ? <span className="mark">正确答案</span> : null}
                  {isWrongPick ? <span className="mark mark-bad">你选的</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {revealed && verdict !== null ? (
        <>
          <div className={verdict ? 'verdict is-good' : 'verdict is-bad'}>
            {verdict ? '答对了' : '答错了'}
          </div>

          {question.explanation ? (
            <div className="explain">
              <div className="explain-title">解析</div>
              <Markdown source={question.explanation} />
            </div>
          ) : null}

          {!verdict ? (
            <div className="tag-picker">
              <div className="tag-picker-label">错在哪？（可多选，也可以不选）</div>
              <div className="chips">
                {TAG_ORDER.map((tag) => {
                  const on = errorTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={on ? 'chip is-on' : 'chip'}
                      onClick={() =>
                        setErrorTags((prev) =>
                          prev.includes(tag)
                            ? prev.filter((t) => t !== tag)
                            : prev.length >= 3
                              ? prev
                              : [...prev, tag],
                        )
                      }
                    >
                      {ERROR_TAG_LABEL[tag]}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={selfConfidence === 1 ? 'lucky-toggle is-on' : 'lucky-toggle'}
              onClick={() => setSelfConfidence((prev) => (prev === 1 ? undefined : 1))}
            >
              {selfConfidence === 1 ? '已标记：这题是蒙的' : '这题我是蒙的'}
            </button>
          )}
        </>
      ) : null}

      <div className="practice-actions">
        {phase === 'answering' ? (
          <>
            <button className="btn btn-primary" onClick={submit} disabled={!response}>
              提交
            </button>
            <span className="muted mono">Enter</span>
          </>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => void next()} disabled={busy}>
              {index + 1 >= total ? '查看结果' : '下一题'}
            </button>
            <span className="muted mono">Enter / →</span>
          </>
        )}
      </div>
    </section>
  );
}
