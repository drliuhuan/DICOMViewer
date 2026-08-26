/**
 * M10-B MPR 厚度模式参数（FR-6.4）：平均/MIP/MinIP → BlendModes 键，
 * 厚度 1–100mm 钳制，默认值语义。
 */
import { describe, expect, it } from 'vitest';
import {
  BLEND_MODE_KEYS,
  MPR_DEFAULT_THICKNESS,
  MPR_DEFAULT_THICKNESS_MODE,
  MPR_THICKNESS_MAX,
  MPR_THICKNESS_MIN,
  MPR_THICKNESS_MODES,
  clampThickness,
  thicknessParams,
} from '../src/features/mpr/mprThickness';

describe('模式常量', () => {
  it('三种模式对应三种 BlendModes 键', () => {
    expect(BLEND_MODE_KEYS.AVERAGE).toBe('AVERAGE_INTENSITY_BLEND');
    expect(BLEND_MODE_KEYS.MIP).toBe('MAXIMUM_INTENSITY_BLEND');
    expect(BLEND_MODE_KEYS.MINIP).toBe('MINIMUM_INTENSITY_BLEND');
  });

  it('UI 选项覆盖三模式，默认 Average / 1mm', () => {
    expect(MPR_THICKNESS_MODES.map((m) => m.id)).toEqual(['AVERAGE', 'MIP', 'MINIP']);
    expect(MPR_DEFAULT_THICKNESS_MODE).toBe('AVERAGE');
    expect(MPR_DEFAULT_THICKNESS).toBe(1);
  });
});

describe('clampThickness', () => {
  it('上下界钳制到 [1, 100]', () => {
    expect(clampThickness(0)).toBe(MPR_THICKNESS_MIN);
    expect(clampThickness(101)).toBe(MPR_THICKNESS_MAX);
    expect(clampThickness(50)).toBe(50);
  });

  it('保留一位小数', () => {
    expect(clampThickness(3.24)).toBe(3.2);
  });

  it('非有限值回退最小厚度', () => {
    expect(clampThickness(Number.NaN)).toBe(MPR_THICKNESS_MIN);
    expect(clampThickness(Number.POSITIVE_INFINITY)).toBe(MPR_THICKNESS_MAX);
  });
});

describe('thicknessParams', () => {
  it('Average + 1mm：单层平均语义（厚度钳制不变）', () => {
    expect(thicknessParams('AVERAGE', 1)).toEqual({
      blendModeKey: 'AVERAGE_INTENSITY_BLEND',
      slabThickness: 1,
    });
  });

  it('MIP/MinIP：映射对应 BlendModes 键', () => {
    expect(thicknessParams('MIP', 10)).toEqual({
      blendModeKey: 'MAXIMUM_INTENSITY_BLEND',
      slabThickness: 10,
    });
    expect(thicknessParams('MINIP', 24)).toEqual({
      blendModeKey: 'MINIMUM_INTENSITY_BLEND',
      slabThickness: 24,
    });
  });

  it('Average + 厚度>1mm：同样启用厚层平均投影', () => {
    expect(thicknessParams('AVERAGE', 25)).toEqual({
      blendModeKey: 'AVERAGE_INTENSITY_BLEND',
      slabThickness: 25,
    });
  });

  it('厚度越界进入厚层模式前先钳制', () => {
    expect(thicknessParams('MIP', 250)).toEqual({
      blendModeKey: 'MAXIMUM_INTENSITY_BLEND',
      slabThickness: MPR_THICKNESS_MAX,
    });
    expect(thicknessParams('MINIP', 0)).toEqual({
      blendModeKey: 'MINIMUM_INTENSITY_BLEND',
      slabThickness: MPR_THICKNESS_MIN,
    });
  });
});