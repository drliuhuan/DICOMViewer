/**
 * 全局快捷键解析（FR-11 子集，M1 范围）。
 *
 * 纯函数：输入标准化后的键盘事件字段，输出动作；不含 DOM 依赖，
 * 文本输入框聚焦守卫（isTextInputTarget）同样可在 Node 下单测。
 */

export type PrimaryToolKey = 'windowLevel' | 'pan' | 'zoom';

export type ShortcutAction =
  | { type: 'toggleInfo' }
  | { type: 'tool'; tool: PrimaryToolKey }
  | { type: 'placeholderMeasurement' }
  | { type: 'fit' }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'layout'; cells: number }
  | { type: 'slicePrev' }
  | { type: 'sliceNext' }
  | { type: 'resetAll' }
  | { type: 'cancelTool' }
  | { type: 'cinePlaceholder' }
  | { type: 'crosshairPlaceholder' }
  | { type: 'deleteAnnotationPlaceholder' };

export interface KeyEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * 文本输入控件聚焦时不触发全局快捷键（FR-11 要求）。
 * 鸭子类型判断，避免依赖 DOM 全局类，便于 Node 环境单测。
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element.isContentEditable === true
  );
}

const ZOOM_IN_KEYS = new Set(['+', '=', 'NumpadAdd', 'Equal']);
const ZOOM_OUT_KEYS = new Set(['-', '_', 'NumpadSubtract', 'Minus']);

/**
 * 解析快捷键。
 * 返回 null 表示未命中任何动作（调用方不应 preventDefault）。
 * 组合键约束：Ctrl/Alt/Meta 修饰的组合一律不处理（留给浏览器）；
 * Shift 仅用于 Shift+R 重置。
 */
export function resolveShortcut(event: KeyEventLike): ShortcutAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  // Shift+R：全局重置（Ctrl+R 与浏览器刷新冲突，需求五轮评审改键）
  if (key === 'r') {
    return event.shiftKey ? { type: 'resetAll' } : { type: 'placeholderMeasurement' };
  }

  switch (key) {
    case 'i':
      return { type: 'toggleInfo' };
    case 'w':
      return { type: 'tool', tool: 'windowLevel' };
    case 'p':
      return { type: 'tool', tool: 'pan' };
    case 'z':
      return { type: 'tool', tool: 'zoom' };
    // 测量工具占位：M3 提供
    case 'l':
    case 'a':
    case 'o':
      return { type: 'placeholderMeasurement' };
    case 'f':
      return { type: 'fit' };
    // Cine 播放（FR-3.8 P1，后续里程碑）
    case ' ':
      return { type: 'cinePlaceholder' };
    // MPR 十字线（FR-6，后续里程碑）
    case 'c':
      return { type: 'crosshairPlaceholder' };
    case 'Escape':
      return { type: 'cancelTool' };
    // 删除选中标注（FR-5.9/M3）
    case 'Delete':
    case 'Backspace':
      return { type: 'deleteAnnotationPlaceholder' };
    default:
      break;
  }

  if (ZOOM_IN_KEYS.has(key)) {
    return { type: 'zoomIn' };
  }
  if (ZOOM_OUT_KEYS.has(key)) {
    return { type: 'zoomOut' };
  }

  switch (key) {
    case '1':
      return { type: 'layout', cells: 1 };
    case '2':
      return { type: 'layout', cells: 2 };
    case '4':
      return { type: 'layout', cells: 4 };
    case 'PageUp':
      return { type: 'slicePrev' };
    case 'PageDown':
      return { type: 'sliceNext' };
    case 'ArrowLeft':
      return { type: 'slicePrev' };
    case 'ArrowRight':
      return { type: 'sliceNext' };
    default:
      return null;
  }
}
