/**
 * M10-D ROI 统计/几何纯函数（FR-5.3/5.4/5.7/5.13）。
 * 已知数组/几何 → 均值/标准差/极值/像素数/面积公式正确；双精度 + 2 位小数。
 */
import { describe, expect, it } from 'vitest';
import {
  computeMaskedStats,
  createStatsAccumulator,
  ellipsePixelCount,
  finalizeStats,
  formatFixed2,
  hasUsablePixelSpacing,
  pixelAreaToMm2,
  pixelDistanceToMm,
  pushToAccumulator,
  rectanglePixelCount,
} from '../src/features/measure/roiStats';

function rectInside(x0: number, y0: number, x1: number, y1: number) {
  return (x: number, y: number) => {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    return x >= left && x <= right && y >= top && y <= bottom;
  };
}

describe('computeMaskedStats（原始像素统计，FR-5.7）', () => {
  it('3×3 已知数组的均值/总体标准差/极值/像素数', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const stats = computeMaskedStats(values, 3, rectInside(0, 0, 2, 2));
    expect(stats).not.toBeNull();
    expect(stats!.mean).toBeCloseTo(5, 12);
    expect(stats!.stdDev).toBeCloseTo(2.58198889747, 10); // 总体标准差 sqrt(avg_sq_diff)
    expect(stats!.min).toBe(1);
    expect(stats!.max).toBe(9);
    expect(stats!.count).toBe(9);
  });

  it('仅取 ROI 子窗口（0..1 行，1..2 列），不经过 VOI LUT', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    // 子窗口像素为 (x=1..2, y=0..1)：2,3,5,6 —— 参数即期望数值对应的窗口
    const stats = computeMaskedStats(values, 3, rectInside(1, 0, 2, 1));
    expect(stats!.count).toBe(4);
    expect(stats!.mean).toBeCloseTo((2 + 3 + 5 + 6) / 4, 12);
  });

  it('Welford 累加器流式追加与批量统计一致', () => {
    const acc = createStatsAccumulator();
    for (const value of [7, 2, 4, 9, 3]) {
      pushToAccumulator(acc, value);
    }
    const stats = finalizeStats(acc);
    expect(stats!.mean).toBeCloseTo(5, 12);
    expect(stats!.min).toBe(2);
    expect(stats!.max).toBe(9);
    expect(stats!.count).toBe(5);

    const direct = computeMaskedStats([7, 2, 4, 9, 3], 5, () => true);
    expect(direct!.mean).toBeCloseTo(stats!.mean, 12);
    expect(direct!.stdDev).toBeCloseTo(stats!.stdDev, 12);
  });

  it('空样本 / 全非有限值返回 null', () => {
    expect(computeMaskedStats([], 4, () => true)).toBeNull();
    expect(
      computeMaskedStats([NaN, Infinity, NaN, 1], 4, () => false),
    ).toBeNull();
  });
});

describe('像素面积（FR-5.3/5.4）', () => {
  it('矩形像素数：紧贴边界的闭区间计数', () => {
    expect(rectanglePixelCount(0, 0, 3, 2, 10, 10)).toBe(12);
    expect(rectanglePixelCount(2, 1, 0, 3, 10, 10)).toBe(9);
  });

  it('矩形完全在图像外 → 0', () => {
    expect(rectanglePixelCount(20, 20, 30, 30, 16, 16)).toBe(0);
  });

  it('椭圆像素数：轴向椭圆 inside ellipse 公式', () => {
    const count = ellipsePixelCount(0, 0, 4, 2, 32, 32);
    // 中心 (2,1)，半径 (2,1)：面积 ≈ π*2*1 ≈ 6.28，整数计数应 > π 且 < bbox（9）
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThanOrEqual(9);
  });
});

describe('像素间距可用性（FR-5.8）', () => {
  it('正有限间距可用；缺失/0/负/NaN 不可用', () => {
    expect(hasUsablePixelSpacing([0.5, 0.5])).toBe(true);
    expect(hasUsablePixelSpacing(undefined)).toBe(false);
    expect(hasUsablePixelSpacing([0, 0.5])).toBe(false);
    expect(hasUsablePixelSpacing([-1, 0.5])).toBe(false);
    expect(hasUsablePixelSpacing([NaN, 0.5])).toBe(false);
    expect(hasUsablePixelSpacing([0.5])).toBe(false);
  });
});

describe('物理尺寸换算（FR-5.13 双精度）', () => {
  it('像素面积 → mm²', () => {
    expect(pixelAreaToMm2(100, [0.5, 0.5])).toBeCloseTo(25, 12);
  });

  it('像素长度 → mm', () => {
    expect(pixelDistanceToMm(20, [0.65625, 0.65])).toBeCloseTo(13.125, 12);
  });

  it('间距缺失返回 null', () => {
    expect(pixelAreaToMm2(100, undefined)).toBeNull();
    expect(pixelDistanceToMm(20, undefined)).toBeNull();
  });
});

describe('formatFixed2（FR-5.13 2 位小数）', () => {
  it('四舍五入到 2 位并附单位', () => {
    expect(formatFixed2(12.345)).toBe('12.35');
    expect(formatFixed2(12.344)).toBe('12.34');
    expect(formatFixed2(3, 'mm')).toBe('3 mm');
    expect(formatFixed2(25.0, 'mm²')).toBe('25 mm²');
  });

  it('非有限值返回 null', () => {
    expect(formatFixed2(undefined)).toBeNull();
    expect(formatFixed2(NaN)).toBeNull();
    expect(formatFixed2(Infinity)).toBeNull();
  });
});