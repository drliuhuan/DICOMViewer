/**
 * File System Access API 的轻量类型补充（FR-1.2）。
 *
 * lib.dom.d.ts（TS 5.9）已内置 FileSystemHandle/FileSystemDirectoryHandle 等
 * 条目类型；仅缺顶层选择器入口 showDirectoryPicker，此处按 MDN 签名补齐，
 * 避免为单个函数引入 @types/wicg-file-system-access。
 */
interface Window {
  /**
   * 打开目录选择器（Chromium 系浏览器）；调用前须以 supportsDirectoryPicker() 能力检测。
   * mode 限定为只读。
   */
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}
