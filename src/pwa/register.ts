/**
 * PWA Service Worker 注册（FR-10.6）。
 * 仅生产构建注册（dev/单测环境跳过，避免干扰 HMR 与 jsdom）；
 * 浏览器不支持 serviceWorker（旧 Safari/非安全上下文）时静默降级。
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) {
    return;
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[PWA] Service Worker 注册失败（离线能力不可用）', error);
    });
  });
}
