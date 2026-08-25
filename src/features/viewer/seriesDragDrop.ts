/**
 * 序列面板 → 视口 的 HTML5 拖拽数据契约（FR-2.8 扩展）。
 *
 * 序列卡片 dragstart 时以自定义 MIME 类型携带 seriesUid，
 * 视口单元格 drop 时读取并加载到该视口。自定义类型用于与
 * 「全窗口拖拽打开外部文件」逻辑互不干扰：
 * dataTransfer.types 在 dragover/dragenter 阶段即可读（getData 不行），
 * 全局文件拖拽处理据此识别并放行内部序列拖拽。
 */

/** 序列卡片拖拽使用的 dataTransfer MIME 类型 */
export const SERIES_UID_MIME = 'application/x-series-uid';

/** 该拖拽事件是否为「内部序列拖拽」（区别于外部文件拖拽） */
export function isSeriesDragEvent(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (!types) {
    return false;
  }
  return Array.from(types).includes(SERIES_UID_MIME);
}

/** 从 drop 事件的 dataTransfer 中读取 seriesUid；非序列拖拽返回 null */
export function readSeriesUidFromDataTransfer(
  dataTransfer: DataTransfer | null,
): string | null {
  if (!dataTransfer) {
    return null;
  }
  const uid = dataTransfer.getData(SERIES_UID_MIME);
  return uid.length > 0 ? uid : null;
}
