/**
 * ROI 统计/几何纯函数（FR-5.3/5.4/5.7/5.8/5.13，M10-D）。
 *
 * - 灰度统计基于 ROI 内原始像素值（未经过 VOI LUT），因此拖动 ROI 或调制
 *   窗宽窗位时数值不变（FR-5.7 语义：统计不随窗宽窗位变化）；
 * - 全部算法使用 IEEE-754 双精度，仅显示时保留 2 位小数（FR-5.13）；
 * - 物理尺寸（mm/mm²）仅在像素间距可用时计算，否则上层提示「无法计算物理尺寸」。
 *
 * 全部纯函数，Node 下单测。
 */

/** 矩形 ROI 两角（任意顺序）归一化为 (left,top)-(right,bottom) */
export function normalizeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

/** 统计矩形包围盒内（含边界）的像素数；完全在图像外返回 0 */
export function rectanglePixelCount(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const { left, top, right, bottom } = normalizeRect(x0, y0, x1, y1);
  const clampedLeft = Math.max(0, Math.floor(left));
  const clampedTop = Math.max(0, Math.floor(top));
  const clampedRight = Math.min(imageWidth - 1, Math.floor(right));
  const clampedBottom = Math.min(imageHeight - 1, Math.floor(bottom));
  if (clampedRight < clampedLeft || clampedBottom < clampedTop) {
    return 0;
  }
  return (clampedRight - clampedLeft + 1) * (clampedBottom - clampedTop + 1);
}

/** 椭圆 ROI 包围盒（cx,cy 中心 + rx,ry 半径） */
export interface EllipseSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** 从椭圆两对角角点计算包围盒参数（cornerstone EllipticalROI 的 handles 为对角角点） */
export function ellipseFromCorners(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): EllipseSpec {
  const { left, top, right, bottom } = normalizeRect(x0, y0, x1, y1);
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    rx: Math.max(0, (right - left) / 2),
    ry: Math.max(0, (bottom - top) / 2),
  };
}

/** 统计椭圆包围盒内（含边界）的像素数；退化（任一半径 ≤0 或包围盒在图像外）返回 0 */
export function ellipsePixelCount(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const { cx, cy, rx, ry } = ellipseFromCorners(x0, y0, x1, y1);
  if (rx <= 0 || ry <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return 0;
  }
  const { left, top, right, bottom } = normalizeRect(x0, y0, x1, y1);
  const iMin = Math.max(0, Math.floor(left));
  const iMax = Math.min(imageWidth - 1, Math.floor(right));
  const jMin = Math.max(0, Math.floor(top));
  const jMax = Math.min(imageHeight - 1, Math.floor(bottom));
  if (iMax < iMin || jMax < jMin) {
    return 0;
  }
  let count = 0;
  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      const dx = (i - cx) / rx;
      const dy = (j - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        count += 1;
      }
    }
  }
  return count;
}

/** 基于像素值数组 + 逐像素是否在 ROI 内计算统计量（不经过 VOI LUT，FR-5.7） */
export function computeMaskedStats(
  values: ArrayLike<number>,
  width: number,
  inside: (x: number, y: number) => boolean,
): PixelStats | null {
  const stats = createStatsAccumulator();
  const height = width > 0 ? Math.floor(values.length / width) : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) {
        continue;
      }
      const value = values[y * width + x];
      if (value === undefined || !Number.isFinite(value)) {
        continue;
      }
      pushToAccumulator(stats, value);
    }
  }
  return finalizeStats(stats);
}

/** 统计结果（stdDev 与 cornerstone BasicStatsCalculator 同为总体标准差） */
export interface PixelStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
}

/** Welford 在线累加器内部状态 */
export interface StatsAccumulator {
  count: number;
  sum: number;
  mean: number;
  m2: number;
  min: number;
  max: number;
}

/** 新建统计累加器 */
export function createStatsAccumulator(): StatsAccumulator {
  return {
    count: 0,
    sum: 0,
    mean: 0,
    m2: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
  };
}

/** 追加一个采样值（Welford 在线算法：数值稳定、不随样本增长累积舍入误差） */
export function pushToAccumulator(state: StatsAccumulator, value: number): void {
  const previousMean = state.mean;
  state.count += 1;
  state.sum += value;
  const delta = value - previousMean;
  state.mean += delta / state.count;
  state.m2 += delta * (value - state.mean);
  if (value < state.min) {
    state.min = value;
  }
  if (value > state.max) {
    state.max = value;
  }
}

/** 由累加器产出最终统计（空样本返回 null）；标准差为总体标准差（除以 count） */
export function finalizeStats(state: Pick<StatsAccumulator, 'count' | 'sum' | 'm2' | 'min' | 'max'>): PixelStats | null {
  if (state.count <= 0) {
    return null;
  }
  const mean = state.sum / state.count;
  return {
    mean,
    stdDev: Math.sqrt(state.m2 / state.count),
    min: state.min,
    max: state.max,
    count: state.count,
  };
}

/** 像素间距是否可用于物理尺寸换算（存在、有限且两轴均 > 0，FR-5.8） */
export function hasUsablePixelSpacing(spacing: readonly number[] | undefined): boolean {
  if (spacing === undefined || spacing.length < 2) {
    return false;
  }
  const row = spacing[0];
  const col = spacing[1];
  return Number.isFinite(row) && Number.isFinite(col) && (row as number) > 0 && (col as number) > 0;
}

/** 像素间距两轴乘积 → 每像素面积系数（px² → mm²） */
export function areaScalePerPixel(spacing: readonly number[] | undefined): number | null {
  if (spacing === undefined || !hasUsablePixelSpacing(spacing)) {
    return null;
  }
  const row = spacing[0];
  const col = spacing[1];
  return (row as number) * (col as number);
}

/** 像素个数 → mm²（双精度）；间距缺失返回 null */
export function pixelAreaToMm2(
  pixelCount: number,
  spacing: readonly number[] | undefined,
): number | null {
  const scale = areaScalePerPixel(spacing);
  if (scale === null) {
    return null;
  }
  return pixelCount * scale;
}

/** 平面内两点欧氏距离（双精度） */
export function distance2d(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 像素长度 → mm（双精度，按行间距）；间距缺失返回 null */
export function pixelDistanceToMm(
  pixelDistance: number,
  spacing: readonly number[] | undefined,
): number | null {
  if (spacing === undefined || !hasUsablePixelSpacing(spacing)) {
    return null;
  }
  const row = spacing[0];
  return pixelDistance * (row as number);
}

/** 格式化：双精度换算后保留 2 位小数并附带单位（FR-5.13）；非有限值返回 null */
export function formatFixed2(value: number | undefined, unit?: string): string | null {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isFinite(rounded) ? String(rounded) : String(value);
  return unit !== undefined && unit !== '' ? `${text} ${unit}` : text;
}

/**
 * 从 ROI 标注 cachedStats 的 statsArray 提取像素计数
 * （Rectangle/Elliptical 工具在 statsArray 中带 name='count' 条目）。
 */
export function countFromStatsArray(statsArray: unknown): number | null {
  if (!Array.isArray(statsArray)) {
    return null;
  }
  for (const item of statsArray) {
    if (
      item !== null &&
      typeof item === 'object' &&
      (item as { name?: string }).name === 'count' &&
      typeof (item as { value?: number }).value === 'number' &&
      Number.isFinite((item as { value: number }).value)
    ) {
      return (item as { value: number }).value;
    }
  }
  return null;
}