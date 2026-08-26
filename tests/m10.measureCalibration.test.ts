/**
 * M10-D 手动校准纯函数（FR-5.8）：比例计算/等效间距/候选选择/输入校验。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeCalibrationScale,
  parsePhysicalLengthMm,
  pickCalibrationCandidate,
  physicalSizeAvailable,
  resetCalibrationStore,
  setSeriesCalibration,
  getSeriesCalibration,
  calibratedSpacingForSeries,
  clearSeriesCalibration,
  lengthToMm,
  spacingFromScale,
} from '../src/features/measure/calibration';

describe('computeCalibrationScale / lengthToMm（FR-5.8）', () => {
  it('已知像素长度与真实长度计算比例（mm/px）', () => {
    expect(computeCalibrationScale(100, 50)).toBe(0.5);
    expect(computeCalibrationScale(10, 25)).toBe(2.5);
  });

  it('非法输入返回 null', () => {
    expect(computeCalibrationScale(0, 50)).toBeNull();
    expect(computeCalibrationScale(-5, 50)).toBeNull();
    expect(computeCalibrationScale(100, 0)).toBeNull();
    expect(computeCalibrationScale(NaN, 50)).toBeNull();
  });

  it('比例 → mm 换算（双精度）', () => {
    expect(lengthToMm(213.333, 0.65625)).toBeCloseTo(139.99978125, 12);
    expect(lengthToMm(10, null)).toBeNull();
  });

  it('比例 → 等效像素间距', () => {
    expect(spacingFromScale(0.5)).toEqual([0.5, 0.5]);
    expect(spacingFromScale(0)).toBeNull();
  });
});

describe('pickCalibrationCandidate', () => {
  const lengths = [
    { annotationUID: 'a', pixelLengthPx: 100, seriesUid: 's1' },
    { annotationUID: 'b', pixelLengthPx: 0, seriesUid: 's2' },
    { annotationUID: 'c', pixelLengthPx: 200, seriesUid: 's2' } as const,
  ];

  it('优先取目标序列中最后一条可用候选', () => {
    expect(pickCalibrationCandidate(lengths, 's2')?.annotationUID).toBe('c');
    expect(pickCalibrationCandidate(lengths, 's1')?.annotationUID).toBe('a');
  });

  it('无候选返回 null；跳过 0/负长度', () => {
    expect(pickCalibrationCandidate([], 's1')).toBeNull();
    expect(pickCalibrationCandidate(
      [{ annotationUID: 'x', pixelLengthPx: 0, seriesUid: 's1' }],
      's1',
    )).toBeNull();
  });
});

describe('parsePhysicalLengthMm', () => {
  it('正有限数字有效；其余无效', () => {
    expect(parsePhysicalLengthMm('50')).toBe(50);
    expect(parsePhysicalLengthMm(' 12.5 ')).toBeCloseTo(12.5, 12);
    expect(parsePhysicalLengthMm('0')).toBeNull();
    expect(parsePhysicalLengthMm('-3')).toBeNull();
    expect(parsePhysicalLengthMm('abc')).toBeNull();
    expect(parsePhysicalLengthMm('')).toBeNull();
  });
});

describe('physicalSizeAvailable（FR-5.8 语义）', () => {
  it('间距可用或已校准（单位 mm）→ 物理尺寸可用', () => {
    expect(physicalSizeAvailable([0.5, 0.5], 'px')).toBe(true);
    expect(physicalSizeAvailable(undefined, 'mm')).toBe(true);
    expect(physicalSizeAvailable(undefined, 'px')).toBe(false);
    expect(physicalSizeAvailable([0, 0.5], 'px')).toBe(false);
  });
});

describe('会话校准登记', () => {
  beforeEach(() => resetCalibrationStore());

  it('set → get / 等效间距 / 清空', () => {
    expect(getSeriesCalibration('s1')).toBeNull();
    setSeriesCalibration('s1', 0.65625);
    expect(getSeriesCalibration('s1')).toBeCloseTo(0.65625, 12);
    expect(calibratedSpacingForSeries('s1')).toEqual([0.65625, 0.65625]);
    expect(calibratedSpacingForSeries('s2')).toBeUndefined();
    clearSeriesCalibration('s1');
    expect(getSeriesCalibration('s1')).toBeNull();
  });

  it('非法比例忽略', () => {
    setSeriesCalibration('s1', 0);
    setSeriesCalibration('s1', NaN);
    expect(getSeriesCalibration('s1')).toBeNull();
  });
});