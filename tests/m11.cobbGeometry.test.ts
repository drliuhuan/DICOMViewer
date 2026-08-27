/**
 * M11 任务 3：Cobb 角纯几何计算单测。
 * 覆盖两线段夹角（垂直/平行/钝角补角/零长退化）、统计富集、
 * SR 三点半角折算（交点 + 远端端点选择、平行跳过）。
 */
import { describe, expect, it } from 'vitest';
import {
  angleBetweenSegmentsDeg,
  cobbDisplayValue,
  cobbEndpointsForSr,
  computeCobbSegmentStats,
  intersectInfiniteLines,
} from '../src/features/measure/cobbGeometry';

describe('angleBetweenSegmentsDeg', () => {
  it('垂直线段 → 90°', () => {
    const angle = angleBetweenSegmentsDeg([0, 0], [10, 0], [0, 0], [0, 5]);
    expect(angle).toBeCloseTo(90, 6);
  });

  it('平行同向 → 0°；反向共线 → 180°', () => {
    expect(angleBetweenSegmentsDeg([0, 0], [1, 0], [5, 5], [9, 5])).toBeCloseTo(0, 6);
    expect(angleBetweenSegmentsDeg([0, 0], [1, 0], [5, 5], [1, 5])).toBeCloseTo(180, 6);
  });

  it('45° 夹角', () => {
    expect(
      angleBetweenSegmentsDeg([0, 0], [1, 0], [0, 0], [1, 1]),
    ).toBeCloseTo(45, 6);
  });

  it('三维世界坐标同样适用（平面内两点 + z 相同）', () => {
    expect(
      angleBetweenSegmentsDeg([0, 0, 0], [10, 0, 0], [0, 0, 0], [0, 7, 0]),
    ).toBeCloseTo(90, 6);
  });

  it('任一线段零长度/点数不足 → null（无方向）', () => {
    expect(angleBetweenSegmentsDeg([0, 0], [0, 0], [1, 0], [2, 0])).toBeNull();
    expect(angleBetweenSegmentsDeg([0, 0], [1, 0], [1, 0], [])).toBeNull();
    expect(angleBetweenSegmentsDeg(undefined, [1, 0], [0, 0], [2, 0])).toBeNull();
  });
});

describe('cobbDisplayValue（医学补角语义）', () => {
  it('[0,90] 原样显示', () => {
    expect(cobbDisplayValue(0)).toBe(0);
    expect(cobbDisplayValue(90)).toBe(90);
    expect(cobbDisplayValue(23.5)).toBeCloseTo(23.5, 4);
  });

  it('钝角取补角：150° → 30°；180°（反向共线）→ 0°', () => {
    expect(cobbDisplayValue(150)).toBeCloseTo(30, 4);
    expect(cobbDisplayValue(180)).toBeCloseTo(0, 4);
    expect(cobbDisplayValue(179.999)).toBeCloseTo(0.001, 3);
  });

  it('非法输入返回 null', () => {
    expect(cobbDisplayValue(null)).toBeNull();
    expect(cobbDisplayValue(Number.NaN)).toBeNull();
  });
});

describe('computeCobbSegmentStats', () => {
  it('四点输入给出原始角/显示角/两段线物理长度', () => {
    const stats = computeCobbSegmentStats([
      [0, 0, 0],
      [30, 0, 0], // 线段 A 长 30mm
      [50, 50, 0],
      [50, 90, 0], // 线段 B 长 40mm，与 A 垂直
    ]);
    expect(stats.rawAngle).toBeCloseTo(90, 6);
    expect(stats.displayAngle).toBeCloseTo(90, 6);
    expect(stats.lineALengthMm).toBeCloseTo(30, 6);
    expect(stats.lineBLengthMm).toBeCloseTo(40, 6);
  });

  it('点数不足（绘制中间态）各字段为 null', () => {
    const stats = computeCobbSegmentStats([[0, 0, 0]]);
    expect(stats.rawAngle).toBeNull();
    expect(stats.lineALengthMm).toBeNull();
  });

  it('undefined 输入安全返回空对象结构', () => {
    expect(computeCobbSegmentStats(undefined).displayAngle).toBeNull();
  });
});

describe('intersectInfiniteLines / cobbEndpointsForSr（SR 折算）', () => {
  it('十字相交：交点与远端端点选择正确', () => {
    const apex = intersectInfiniteLines([-10, 5], [1, 5], [3, -8], [3, 9]);
    expect(apex).toEqual({ x: 3, y: 5 });
    const triple = cobbEndpointsForSr([
      [-10, 5],
      [1, 5],
      [3, -8],
      [3, 9],
    ]);
    expect(triple).toEqual({
      start: { x: -10, y: 5 },
      middle: { x: 3, y: 5 },
      end: { x: 3, y: -8 },
    });
  });

  it('平行线无交点 → null（SR 跳过该条测量）', () => {
    expect(intersectInfiniteLines([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull();
    expect(
      cobbEndpointsForSr([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
    ).toBeNull();
  });

  it('点位不足返回 null', () => {
    expect(cobbEndpointsForSr([[0, 0]])).toBeNull();
    expect(cobbEndpointsForSr(undefined)).toBeNull();
  });
});
