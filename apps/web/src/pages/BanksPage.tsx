import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db';

function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('zh-CN');
}

export function BanksPage() {
  const banks = useLiveQuery(() => db.banks.orderBy('updatedAt').reverse().toArray(), []);

  if (!banks) return <p className="muted">读取本地数据库…</p>;

  if (banks.length === 0)
    return (
      <section className="empty">
        <h1>还没有题库</h1>
        <p className="muted">
          导入一个符合契约的 JSON 题库包就能开始。数据只存在这台设备的浏览器里。
        </p>
        <Link className="btn btn-primary" to="/import">
          导入题库
        </Link>
      </section>
    );

  const total = banks.reduce((sum, b) => sum + b.questionCount, 0);

  return (
    <section>
      <div className="section-head">
        <h1>题库</h1>
        <span className="muted">
          {banks.length} 个题库 · {total} 道题
        </span>
      </div>

      <ul className="card-grid">
        {banks.map((bank) => (
          <li key={bank.id}>
            <Link className="card" to={`/bank/${bank.id}`}>
              <div className="card-title">{bank.name}</div>
              {bank.description ? <p className="card-desc">{bank.description}</p> : null}
              <div className="card-meta">
                <span className="pill">{bank.questionCount} 题</span>
                <span className="mono muted">v{bank.version}</span>
                <span className="muted">{formatDate(bank.updatedAt)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
