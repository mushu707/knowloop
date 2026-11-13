import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { BanksPage } from './pages/BanksPage';
import { BankPage } from './pages/BankPage';
import { QuestionPage } from './pages/QuestionPage';
import { ImportPage } from './pages/ImportPage';
import { PracticePage } from './pages/PracticePage';
import { MistakesPage } from './pages/MistakesPage';
import { ProgressPage } from './pages/ProgressPage';

function NotFound() {
  const { '*': rest } = useParams();
  return (
    <div className="empty">
      <h2>页面不存在</h2>
      <p className="muted">/{rest}</p>
      <Link className="btn" to="/">
        回题库列表
      </Link>
    </div>
  );
}

function Shell() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          knowloop
        </Link>
        <span className="tagline">把你的面经变成能刷的题</span>
        <nav className="nav">
          <NavLink to="/" end>
            题库
          </NavLink>
          <NavLink to="/import">导入</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<BanksPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/bank/:bankId" element={<BankPage />} />
          <Route path="/bank/:bankId/mistakes" element={<MistakesPage />} />
          <Route path="/practice/:bankId" element={<PracticePage />} />
          <Route path="/review/:bankId" element={<PracticePage mode="review" />} />
          <Route path="/bank/:bankId/progress" element={<ProgressPage />} />
          <Route path="/q/:questionId" element={<QuestionPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">
        <span>数据全部保存在这台设备的浏览器里，没有账号，没有上传。</span>
        <span className="mono">v0.1 · S3</span>
      </footer>
    </div>
  );
}

export function App() {
  return <Shell />;
}
