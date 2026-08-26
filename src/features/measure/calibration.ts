/**
 * 像素间距缺失处理与手动校准（FR-5.8，M10-D）。
 *
 * - 间距缺失/为 0 时禁用物理数值显示并提示「无法计算物理尺寸」；
 * - 校准流程：长度工具画线（已知像素长度）→ 输入真实物理长度 mm →
 *   计算校准比例（mm/px）→ 交给 cornerstone calibrateImageSpacing 应用。
 *
 * 全部纯函数，Node 下单测。
 */
import { hasUsablePixelSpacing, formatFixed2 } from './roiStats';

export { hasUsablePixelSpacing };

/**
 * 由已知物理长度与像素长度计算校准比例（mm/px）。
 * 像素长度 ≤0 或非有限时返回 null（无意义的校准）。
 */
export function computeCalibrationScale(
  pixelLengthPx: number,
  physicalLengthMm: number,
): number | null {
  if (
    !Number.isFinite(pixelLengthPx) ||
    !Number.isFinite(physicalLengthMm) ||
    pixelLengthPx <= 0 ||
    physicalLengthMm <= 0
  ) {
    return null;
  }
  return physicalLengthMm / pixelLengthPx;
}

/** 由校准比例把像素长度换算为 mm（双精度）；无有效比例返回 null */
export function lengthToMm(
  pixelLengthPx: number,
  scaleMmPerPx: number | null,
): number | null {
  if (scaleMmPerPx === null || !Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) {
    return null;
  }
  if (!Number.isFinite(pixelLengthPx)) {
    return null;
  }
  return pixelLengthPx * scaleMmPerPx;
}

/** 由校准比例反向推导等效像素间距（[行, 列]，mm/px）供元数据回填 */
export function spacingFromScale(
  scaleMmPerPx: number,
): [number, number] | null {
  if (!Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) {
    return null;
  }
  return [scaleMmPerPx, scaleMmPerPx];
}

/**
 * 从一组长度标注取「当前序列最近一条」的像素长度。
 * 若标注尚无统计值或间距已可用（无需校准）则返回 null。
 *
 * @param lengths 每个候选项 { annotationUID, pixelLengthPx, seriesUid }
 * @param seriesUid 目标序列（null 表示取任意最新一条）
 * @returns 用于校准的候选项，若无则 null
 */
export interface CalibrationCandidate {
  annotationUID: string;
  pixelLengthPx: number;
  seriesUid: string | null;
}

export function pickCalibrationCandidate(
  lengths: readonly CalibrationCandidate[],
  seriesUid: string | null,
): CalibrationCandidate | null {
  if (lengths.length === 0) {
    return null;
  }
  const inSeries = seriesUid !== null ? lengths.filter((it) => it.seriesUid === seriesUid) : lengths;
  const pool = inSeries.length > 0 ? inSeries : lengths;
  const usable = pool.filter(
    (it) => Number.isFinite(it.pixelLengthPx) && it.pixelLengthPx > 0,
  );
  return usable.length > 0 ? (usable[usable.length - 1] ?? null) : null;
}

/** 校验用户输入的真实物理长度（正有限数） */
export function parsePhysicalLengthMm(input: string): number | null {
  const value = Number(input.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 判断一条长度标注是否「物理尺寸可用」。
 * @param spacing 像素间距（缺失时为 undefined）
 * @param cachedUnit 工具统计给出的单位（无间距时为 'px'）
 */
export function physicalSizeAvailable(
  spacing: readonly number[] | undefined,
  cachedUnit: string | undefined,
): boolean {
  if (hasUsablePixelSpacing(spacing)) {
    return true;
  }
  // 已校准的序列单位即 mm（即便原始间距缺失）
  return typeof cachedUnit === 'string' && cachedUnit.startsWith('mm');
}

/** 间距缺失/校准缺省时的提示文案（FR-5.8） */
export const MISSING_SPACING_HINT = '无法计算物理尺寸：像素间距缺失或为 0，请先校准';

/** 格式化校准比例，用于 toast 确认 */
export function formatCalibrationScale(scaleMmPerPx: number): string {
  const text = formatFixed2(scaleMmPerPx);
  return text !== null ? `${text} mm/px` : '未知';
}

// ── 会话内校准记忆 ──────────────────────────────────────
// 校准作用于 cornerstone 的 calibratedPixelSpacing 元数据 provider；此处另存
// 一份「按序列」的会话内登记，供面板/解析器判断该序列已校准（等效像素间距）。

const calibrationBySeries = new Map<string, number>();

/** 登记某序列的手动校准比例（mm/px），用于解析器回填等效像素间距 */
export function setSeriesCalibration(seriesUid: string, scaleMmPerPx: number): void {
  if (typeof seriesUid !== 'string' || seriesUid === '' || !Number.isFinite(scaleMmPerPx) || scaleMmPerPx <= 0) {
    return;
  }
  calibrationBySeries.set(seriesUid, scaleMmPerPx);
}

/** 读取某序列的已登记校准比例；无则 null */
export function getSeriesCalibration(seriesUid: string | null | undefined): number | null {
  if (seriesUid === null || seriesUid === undefined) {
    return null;
  }
  return calibrationBySeries.get(seriesUid) ?? null;
}

/** 已校准序列的等效像素间距（[行, 列]，mm/px 各轴相等）；未校准返回 undefined */
export function calibratedSpacingForSeries(
  seriesUid: string | null | undefined,
): readonly number[] | undefined {
  const scale = getSeriesCalibration(seriesUid);
  if (scale === null) {
    return undefined;
  }
  return [scale, scale];
}

/** 序列关闭/清空数据时清除其校准登记 */
export function clearSeriesCalibration(seriesUid: string): void {
  calibrationBySeries.delete(seriesUid);
}

/** 测试辅助：清空全部校准登记 */
export function resetCalibrationStore(): void {
  calibrationBySeries.clear();
}