/**
 * M1 窗宽窗位预设与 WW/WL↔VOI 换算测试（FR-3.3）。
 */
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_WW_WL,
  WW_WL_PRESETS,
  findPresetById,
  getDefaultWwWlForModality,
  voiRangeFromWwWl,
  wwWlFromVoiRange,
} from '../src/features/viewer/wwPresets';

describe('WW/WL 预设映射（FR-3.3）', () => {
  it('需求基线的 CT 预设值正确', () => {
    expect(findPresetById('ct-brain')).toMatchObject({ ww: 80, wl: 40 });
    expect(findPresetById('ct-lung')).toMatchObject({ ww: 1500, wl: -600 });
    expect(findPresetById('ct-bone')).toMatchObject({ ww: 2500, wl: 500 });
    expect(findPresetById('ct-soft-tissue')).toMatchObject({ ww: 400, wl: 40 });
  });

  it('CT 未带文件窗宽窗位时默认软组织预设', () => {
    expect(getDefaultWwWlForModality('CT')).toEqual({ ww: 400, wl: 40 });
  });

  it('MR 使用 MR 默认预设', () => {
    expect(getDefaultWwWlForModality('MR')).toEqual({ ww: 400, wl: 40 });
    expect(WW_WL_PRESETS.some((p) => p.id === 'mr-default')).toBe(true);
  });

  it('文件自带窗宽窗位时优先使用', () => {
    expect(
      getDefaultWwWlForModality('CT', { windowWidth: 350, windowCenter: 50 }),
    ).toEqual({ ww: 350, wl: 50 });
  });

  it('非法窗宽（≤0/NaN）回退：模态预设 → 通用兜底', () => {
    expect(getDefaultWwWlForModality('CT', { windowWidth: -1, windowCenter: 40 })).toEqual({
      ww: 400,
      wl: 40,
    });
    expect(
      getDefaultWwWlForModality('PT', { windowWidth: Number.NaN, windowCenter: 2 }),
    ).toEqual(FALLBACK_WW_WL);
  });
});

describe('WW/WL ↔ VOI range 换算', () => {
  it('voiRangeFromWwWl：脑窗 80/40 → [0, 80]', () => {
    expect(voiRangeFromWwWl(80, 40)).toEqual({ upper: 80, lower: 0 });
  });

  it('负窗位：肺窗 1500/-600 → [-1350, 150]', () => {
    expect(voiRangeFromWwWl(1500, -600)).toEqual({ upper: 150, lower: -1350 });
  });

  it('roundtrip 换算保持一致', () => {
    const range = voiRangeFromWwWl(2500, 500);
    expect(wwWlFromVoiRange(range)).toEqual({ ww: 2500, wl: 500 });
  });

  it('非法输入不产生 NaN', () => {
    const range = voiRangeFromWwWl(Number.NaN, Number.NaN);
    expect(Number.isFinite(range.upper)).toBe(true);
    expect(Number.isFinite(range.lower)).toBe(true);
  });
});
