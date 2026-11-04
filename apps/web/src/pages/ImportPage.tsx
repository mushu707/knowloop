import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { importPack, type ImportReport } from '../db/repo';

export function ImportPage() {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function run(raw: unknown, label: string) {
    setBusy(true);
    setError(null);
    setReport(null);
    setSource(label);
    try {
      setReport(await importPack(raw));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    const text = await file.text();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setError(`「${file.name}」不是合法的 JSON 文件`);
      setReport(null);
      return;
    }
    await run(raw, file.name);
  }

  async function loadSeed() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}seed.json`);
      if (!res.ok) throw new Error(`读取示例失败：HTTP ${res.status}`);
      await run(await res.json(), 'seed.json（内置示例）');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <section>
      <div className="section-head">
        <h1>导入题库</h1>
      </div>
      <p className="lede">
        支持符合 <code>BankPack</code> 契约的 JSON。导入时会逐题做结构校验、重算内容哈希、按
        id 去重——不合格的题目会被拒绝并列出来，不会污染已有数据。
      </p>

      <div
        className={dragging ? 'dropzone is-dragging' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <strong>把 JSON 拖到这里</strong>
        <span className="muted">或点击选择文件</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <div className="row-actions">
        <button className="btn" onClick={() => void loadSeed()} disabled={busy}>
          载入内置示例（20 题）
        </button>
        <span className="muted">等价于导入 repositories 里的 fixtures/questions.seed.json</span>
      </div>

      {busy ? <p className="muted">导入中…</p> : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      {report ? (
        <div className={report.ok ? 'report' : 'report is-failed'}>
          <div className="report-head">
            <span>{source}</span>
            <span className={report.ok ? 'badge badge-ok' : 'badge badge-bad'}>
              {report.ok ? '导入完成' : '导入失败'}
            </span>
          </div>

          {report.fatal ? <p className="alert alert-error">{report.fatal}</p> : null}

          {report.ok ? (
            <>
              <ul className="stat-row">
                <li>
                  <span className="stat-value">{report.accepted}</span>
                  <span className="stat-label">入库题目 / 共 {report.total}</span>
                </li>
                <li>
                  <span className="stat-value">{report.rejected.length}</span>
                  <span className="stat-label">被拒绝</span>
                </li>
                <li>
                  <span className="stat-value">{report.duplicates}</span>
                  <span className="stat-label">重复跳过</span>
                </li>
                <li>
                  <span className="stat-value">{report.rewrittenIds}</span>
                  <span className="stat-label">id 被重算</span>
                </li>
              </ul>

              {report.replacedExisting ? (
                <p className="muted">该题库已存在，本次是覆盖导入（作答记录未被动过）。</p>
              ) : null}

              {report.rejected.length > 0 ? (
                <details className="issues" open>
                  <summary>被拒绝的题目（{report.rejected.length}）</summary>
                  <ul>
                    {report.rejected.map((issue) => (
                      <li key={`${issue.index}-${issue.questionId}`}>
                        <span className="mono">#{issue.index}</span> {issue.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {report.notices.length > 0 ? (
                <details className="issues">
                  <summary>质量提示（{report.notices.length}，不影响入库）</summary>
                  <ul>
                    {report.notices.map((notice) => (
                      <li key={`${notice.questionId}-${notice.code}`}>
                        <span className="mono">{notice.questionId}</span> {notice.message}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {report.bankId ? (
                <Link className="btn btn-primary" to={`/bank/${report.bankId}`}>
                  查看题库
                </Link>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
