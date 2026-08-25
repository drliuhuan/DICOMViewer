import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { registerServiceWorker } from './pwa/register';
import './app/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA 离线壳（FR-10.6）：仅生产构建注册
registerServiceWorker();
