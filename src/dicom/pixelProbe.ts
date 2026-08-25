/**
 * 像素值探针（FR-4.5）。
 *
 * 灰度值显示遵循 Modality LUT：displayed = stored × rescaleSlope + rescaleIntercept
 * （CT 即 HU；rescale 缺失时 slope=1/intercept=0，显示原始存储值）。
 * 全部纯函数，可在 Node 下单测。
 */

/** Modality LUT 线性变换（FR-1.9/FR-3.1） */
export function applyModalityLut(
  storedValue: number,
  slope: number,
  intercept: number,
): number {
  const s = Number.isFinite(slope) ? slope : 1;
  const c = Number.isFinite(intercept) ? intercept : 0;
  return storedValue * s + c;
}

export interface PixelSample {
  /** 单通道：灰度（Modality LUT 后）；彩色：R/G/B 各自经 LUT 前 raw */
  gray?: number;
  rgb?: [number, number, number];
}

/**
 * 从像素数组采样指定坐标。
 * @param components 每像素分量数（灰度=1，RGB=3）
 */
export function samplePixel(
  pixelData: ArrayLike<number>,
  width: number,
  x: number,
  y: number,
  components = 1,
): PixelSample | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || components <= 0) {
    return null;
  }
  const offsetBase = y * width * components + x * components;
  const needed = offsetBase + components;
  if (offsetBase < 0 || needed > pixelData.length) {
    return null;
  }
  if (components >= 3) {
    return {
      rgb: [
        pixelData[offsetBase] ?? 0,
        pixelData[offsetBase + 1] ?? 0,
        pixelData[offsetBase + 2] ?? 0,
      ],
    };
  }
  return { gray: pixelData[offsetBase] ?? 0 };
}

/** 按 Modality LUT 计算并格式化灰度值文本（CT 显示 HU） */
export function formatGrayValue(
  sample: PixelSample,
  modality: string,
  slope = 1,
  intercept = 0,
): string | null {
  if (sample.rgb !== undefined) {
    return `RGB(${sample.rgb.join(', ')})`;
  }
  if (sample.gray === undefined) {
    return null;
  }
  const displayed = applyModalityLut(sample.gray, slope, intercept);
  const rounded = Math.round(displayed * 100) / 100;
  const unit = modality.toUpperCase() === 'CT' ? ' HU' : '';
  return `${rounded}${unit}`;
}
