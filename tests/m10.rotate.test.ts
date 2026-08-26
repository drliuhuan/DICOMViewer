/**
 * M10-E 旋转度数计算与方向标记随动单测（FR-3.10 + FR-4.10）。
 * 纯逻辑：normalizeRotation / addRotation / rotateOrientationMarkers。
 */
import { describe, expect, it } from 'vitest';
import { computeOrientationMarkers } from '../src/features/viewer/orientation';
import {
  addRotation,
  normalizeRotation,
  rotateOrientationMarkers,
} from '../src/features/viewer/viewTransform';

describe('normalizeRotation / addRotation', () => {
  it('度数收敛到 [0,360)', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it('叠加增量（正=逆时针）', () => {
    expect(addRotation(0, 90)).toBe(90);
    expect(addRotation(90, 90)).toBe(180);
    expect(addRotation(0, -90)).toBe(270);
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(10, 90)).toBe(100);
  });
});

describe('rotateOrientationMarkers（FR-4.10 旋转后方向标记随动）', () => {
  // 轴向 HFS 原始标记：顶部前(A)/底部后(P)/左侧右(R)/右侧左(L)
  const base = computeOrientationMarkers([1, 0, 0, 0, 1, 0])!;
  expect(base).toEqual({ top: 'A', right: 'L', bottom: 'P', left: 'R' });

  it('0°/360° 返回原样', () => {
    expect(rotateOrientationMarkers(base, 0)).toBe(base);
    expect(rotateOrientationMarkers(base, 360)).toBe(base);
  });

  it('逆时针 90°：top←left、right←top、bottom←right、left←bottom', () => {
    expect(rotateOrientationMarkers(base, 90)).toEqual({
      top: 'R',
      right: 'A',
      bottom: 'L',
      left: 'P',
    });
  });

  it('逆时针 180°：上下/左右对调', () => {
    expect(rotateOrientationMarkers(base, 180)).toEqual({
      top: 'P',
      right: 'R',
      bottom: 'A',
      left: 'L',
    });
  });

  it('逆时针 270° = 顺时针 90°，四步后复原', () => {
    expect(rotateOrientationMarkers(base, 270)).toEqual({
      top: 'L',
      right: 'P',
      bottom: 'R',
      left: 'A',
    });
    expect(rotateOrientationMarkers(base, 450)).toEqual(
      rotateOrientationMarkers(base, 90),
    );
  });

  it('负角度（顺时针）等价于 360-θ 逆时针', () => {
    expect(rotateOrientationMarkers(base, -90)).toEqual(
      rotateOrientationMarkers(base, 270),
    );
    expect(rotateOrientationMarkers(base, -450)).toEqual(
      rotateOrientationMarkers(base, 270),
    );
  });
});