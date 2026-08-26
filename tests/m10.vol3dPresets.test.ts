/**
 * M10-C 3D 渲染预设纯数据（FR-7.2）：五预设（CT-Bone/Angio/Soft-Tissue/Skin/MIP）
 * 结构、控制点排序、范围与合法性校验；find/preset 查找。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME3D_PRESET_ID,
  PRESET_SCALAR_MAX,
  PRESET_SCALAR_MIN,
  VOLUME3D_PRESETS,
  findVolume3dPreset,
  validateAllVolume3dPresets,
  validateVolume3dPreset,
  type Volume3dPreset,
} from '../src/features/volume3d/presets';

describe('内置预设清单（FR-7.2）', () => {
  it('恰好五个预设，id 与显示名符合需求', () => {
    expect(VOLUME3D_PRESETS.map((p) => p.id)).toEqual([
      'ct-bone',
      'ct-angio',
      'ct-soft-tissue',
      'ct-skin',
      'mip',
    ]);
    const labels = VOLUME3D_PRESETS.map((p) => p.label);
    expect(labels).toContain('CT-Bone');
    expect(labels).toContain('CT-Angio');
    expect(labels).toContain('CT-Soft-Tissue');
    expect(labels).toContain('CT-Skin');
    expect(labels).toContain('MIP');
  });

  it('默认预设为 CT-Bone，findVolume3dPreset 命中/未命中', () => {
    expect(DEFAULT_VOLUME3D_PRESET_ID).toBe('ct-bone');
    expect(findVolume3dPreset('ct-bone')?.id).toBe('ct-bone');
    expect(findVolume3dPreset('nope')).toBeUndefined();
  });
});

describe('预设合法性校验（纯函数）', () => {
  it('全部内置预设通过校验（控制点有序、范围有效、通道收敛）', () => {
    const result = validateAllVolume3dPresets();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('每个预设：颜色 ≥2 节点、不透明度 ≥2 节点、x 严格升序、色值/不透明度 ∈[0,1]', () => {
    for (const preset of VOLUME3D_PRESETS) {
      expect(preset.color.length).toBeGreaterThanOrEqual(2);
      expect(preset.opacity.length).toBeGreaterThanOrEqual(2);
      expect(preset.ww).toBeGreaterThan(0);
      const colorX = preset.color.map((n) => n.x);
      const opacityX = preset.opacity.map((n) => n.x);
      for (let i = 1; i < colorX.length; i += 1) {
        expect(colorX[i]!).toBeGreaterThan(colorX[i - 1]!);
      }
      for (let i = 1; i < opacityX.length; i += 1) {
        expect(opacityX[i]!).toBeGreaterThan(opacityX[i - 1]!);
      }
      for (const node of preset.color) {
        expect(node.x).toBeGreaterThanOrEqual(PRESET_SCALAR_MIN);
        expect(node.x).toBeLessThanOrEqual(PRESET_SCALAR_MAX);
        expect(node.r).toBeGreaterThanOrEqual(0);
        expect(node.r).toBeLessThanOrEqual(1);
        expect(node.g).toBeGreaterThanOrEqual(0);
        expect(node.g).toBeLessThanOrEqual(1);
        expect(node.b).toBeGreaterThanOrEqual(0);
        expect(node.b).toBeLessThanOrEqual(1);
      }
      for (const node of preset.opacity) {
        expect(node.opacity).toBeGreaterThanOrEqual(0);
        expect(node.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('颜色节点乱序 → 校验失败并给出去降序提示', () => {
    const preset: Volume3dPreset = {
      ...VOLUME3D_PRESETS[0]!,
      color: [
        { x: 300, r: 0, g: 0, b: 0 },
        { x: -1024, r: 1, g: 1, b: 1 },
      ],
    };
    const result = validateVolume3dPreset(preset);
    expect(result.valid).toBe(false);
    expect(result.errors.join('; ')).toContain('升序');
  });

  it('不透明度超出 [0,1] → 校验失败', () => {
    const preset: Volume3dPreset = {
      ...VOLUME3D_PRESETS[0]!,
      opacity: [
        { x: -1024, opacity: 1.5 },
        { x: 0, opacity: 0 },
      ],
    };
    const result = validateVolume3dPreset(preset);
    expect(result.valid).toBe(false);
    expect(result.errors.join('; ')).toContain('[0,1]');
  });

  it('窗宽非正 / 节点过少 → 校验失败', () => {
    const preset: Volume3dPreset = {
      id: 'bad',
      label: '',
      description: 'x',
      ww: 0,
      wl: NaN,
      color: [{ x: 0, r: 0, g: 0, b: 0 }],
      opacity: [{ x: 0, opacity: 0 }],
    };
    const result = validateVolume3dPreset(preset);
    expect(result.valid).toBe(false);
    expect(result.errors.join('; ')).toContain('label 不能为空');
    expect(result.errors.join('; ')).toContain('ww 必须为正数');
    expect(result.errors.join('; ')).toContain('wl 必须为有限数');
    expect(result.errors.join('; ')).toContain('至少需要 2 个节点');
  });
});