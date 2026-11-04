import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');

createRoot(container).render(
  <StrictMode>
    {/* 纯静态托管没有服务端重写规则，hash 路由刷新不会 404 */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
