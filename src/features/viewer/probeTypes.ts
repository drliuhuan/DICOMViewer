/**
 * 像素探针状态（FR-4.5）——视口组件与覆盖文字之间的共享类型。
 */

export interface PixelProbe {
  /** 图像像素坐标（0 起始，列方向） */
  imageX: number;
  /** 图像像素坐标（0 起始，行方向） */
  imageY: number;
  /** 已格式化的灰度值文本（CT 为 HU；彩色为 RGB(...)）；采样失败为 null */
  valueText: string | null;
}
