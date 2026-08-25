/**
 * M1 像素探针（Modality LUT/HU）与方向标记计算测试（FR-4.5/FR-4.10）。
 */
import { describe, expect, it } from 'vitest';
import {
  applyModalityLut,
  formatGrayValue,
  samplePixel,
} from '../src/dicom/pixelProbe';
import { computeOrientationMarkers } from '../src/features/viewer/orientation';

describe('Modality LUT（rescale slope/intercept → HU）', () => {
  it('CT 典型 rescale：slope=1, intercept=-1024', () => {
    expect(applyModalityLut(1000, 1, -1024)).toBe(-24);
    expect(applyModalityLut(0, 1, -1024)).toBe(-1024); // 空气
    expect(applyModalityLut(1064, 1, -1024)).toBe(40); // 水 ≈ 40HU 存储
  });

  it('非单位斜率（如增强 CT）正确换算', () => {
    expect(applyModalityLut(200, 2, -1024)).toBe(-624);
  });

  it('缺失 rescale 时按 slope=1/intercept=0 处理', () => {
    expect(applyModalityLut(42, Number.NaN, Number.NaN)).toBe(42);
  });
});

describe('像素采样与格式化（FR-4.5）', () => {
  const pixels = [10, 11, 12, 13, 14, 15]; // 3×2 灰度图
  it('按行主序取值：宽 3，(x=2,y=1) → 15', () => {
    expect(samplePixel(pixels, 3, 2, 1, 1)).toEqual({ gray: 15 });
    expect(samplePixel(pixels, 3, 0, 0, 1)).toEqual({ gray: 10 });
  });

  it('越界返回 null 而不是崩溃', () => {
    expect(samplePixel(pixels, 3, 3, 1, 1)).toBeNull();
    expect(samplePixel(pixels, 3, -1, 0, 1)).toBeNull();
  });

  it('RGB 三分量取三通道', () => {
    const rgb = [1, 2, 3, 4, 5, 6];
    expect(samplePixel(rgb, 2, 0, 0, 3)).toEqual({ rgb: [1, 2, 3] });
    expect(samplePixel(rgb, 2, 1, 0, 3)).toEqual({ rgb: [4, 5, 6] });
  });

  it('CT 显示 HU 单位，其他模态显示原始值', () => {
    const sample = { gray: 1064 };
    expect(formatGrayValue(sample, 'CT', 1, -1024)).toBe('40 HU');
    expect(formatGrayValue(sample, 'MR')).toBe('1064');
  });

  it('彩色样本显示 RGB 文本', () => {
    expect(formatGrayValue({ rgb: [255, 128, 0] }, 'US')).toBe('RGB(255, 128, 0)');
  });
});

describe('方向标记计算（FR-4.10）', () => {
  it('标准轴位（IOP=[1,0,0,0,1,0]）：上A 下P 左R 右L', () => {
    expect(computeOrientationMarkers([1, 0, 0, 0, 1, 0])).toEqual({
      top: 'A',
      bottom: 'P',
      left: 'R',
      right: 'L',
    });
  });

  it('标准冠状位（IOP=[1,0,0,0,0,-1]）：上S 下I 左R 右L', () => {
    expect(computeOrientationMarkers([1, 0, 0, 0, 0, -1])).toEqual({
      top: 'S',
      bottom: 'I',
      left: 'R',
      right: 'L',
    });
  });

  it('标准矢状位（IOP=[0,1,0,0,0,-1]）：上S 下I 左A 右P', () => {
    expect(computeOrientationMarkers([0, 1, 0, 0, 0, -1])).toEqual({
      top: 'S',
      bottom: 'I',
      left: 'A',
      right: 'P',
    });
  });

  it('负行方向的轴位翻转左右标签', () => {
    // 行方向 -x → 右缘 R；列方向 +y → 下缘 P
    expect(computeOrientationMarkers([-1, 0, 0, 0, 1, 0])).toEqual({
      top: 'A',
      bottom: 'P',
      left: 'L',
      right: 'R',
    });
  });

  it('斜行方向（无主导轴）返回 null', () => {
    expect(
      computeOrientationMarkers([
        Math.SQRT1_2, Math.SQRT1_2, 0,
        0, 0, 1,
      ]),
    ).toBeNull();
  });

  it('缺失/非法 IOP 返回 null', () => {
    expect(computeOrientationMarkers(undefined)).toBeNull();
    expect(computeOrientationMarkers(null)).toBeNull();
    expect(computeOrientationMarkers([])).toBeNull();
    expect(computeOrientationMarkers([1, 0, 0])).toBeNull();
  });
});
