/**
 * PWA Service Worker 注册（FR-10.6）。
 * 仅生产构建注册（dev/单测环境跳过，避免干扰 HMR 与 jsdom）；
 * 浏览器不支持 serviceWorker（旧 Safari/非安全上下文）时静默降级。
 *
 * M9（FR-14.7）：manifest 已含 standalone 显示 + PNG 图标（192/512，
 * 含 maskable），iOS apple-touch-icon 指向 PNG。
 * TODO(FR-14.7)：移动端启动画面（apple-touch-startup-image / 多尺寸
 * splash）未做——需按常见设备分辨率生成一组 PNG，P1。
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
