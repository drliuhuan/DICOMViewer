/**
 * 3D 体绘制渲染预设数据（FR-7.2，M10-C）。
 *
 * 每个预设 = 颜色传递函数（vtkColorTransferFunction 的 RGB 节点，HU 标度）
 * + 不透明度传递函数（vtkPiecewiseFunction 的节点，0..1）。
 * 数值参考医学影像惯例：CT-Bone 突出骨窗等高值、CT-Angio 血管增强、
 * CT-Soft-Tissue 软组织窗、CT-Skin 皮肤表面、MIP 最大值投影。
 *
 * 本文件为「纯数据 + 纯校验」，不 import vtk.js（Node 单测安全）；
 * 真实 vtk 对象的装配在 apply.ts（vtk 动态 import + 可注入对象）。
 */

/** 颜色传递函数 RGB 节点（x = HU 标度值，r/g/b ∈ [0,1]） */
export interface RgbNode {
  x: number;
  r: number;
  g: number;
  b: number;
}

/** 不透明度传递函数节点（x = HU 标度值，opacity ∈ [0,1]） */
export interface OpacityNode {
  x: number;
  opacity: number;
}

export interface Volume3dPreset {
  /** 稳定 id（预设下拉/持久化用，ASCII） */
  id: string;
  /** 简体中文显示名 */
  label: string;
  /** 一句话说明（工具栏 title 提示） */
  description: string;
  /** 建议窗宽窗位（初始 VOI 映射范围 / 2D 联动，FR-7.3） */
  ww: number;
  wl: number;
  /** 颜色传递函数控制点（升序 x） */
  color: readonly RgbNode[];
  /** 不透明度传递函数控制点（升序 x） */
  opacity: readonly OpacityNode[];
}

/** 默认预设（进入 3D 时的初始预设） */
export const DEFAULT_VOLUME3D_PRESET_ID = 'ct-bone';

/** 预设 x 标度下界（CT HU 惯例，空气约 -1000，留一点余量） */
export const PRESET_SCALAR_MIN = -1100;
/** 预设 x 标度上界 */
export const PRESET_SCALAR_MAX = 4000;

export const VOLUME3D_PRESETS: readonly Volume3dPreset[] = Object.freeze([
  {
    id: 'ct-bone',
    label: 'CT-Bone',
    description: '骨窗：突出骨骼等高 HU 结构',
    ww: 2500,
    wl: 500,
    color: [
      { x: -1024, r: 0, g: 0, b: 0 },
      { x: -400, r: 0.55, g: 0.4, b: 0.3 },
      { x: 0, r: 0.7, g: 0.6, b: 0.5 },
      { x: 300, r: 0.95, g: 0.95, b: 0.95 },
      { x: 1200, r: 1, g: 1, b: 1 },
      { x: 3000, r: 1, g: 1, b: 1 },
    ],
    opacity: [
      { x: -1024, opacity: 0 },
      { x: -400, opacity: 0 },
      { x: -100, opacity: 0.05 },
      { x: 0, opacity: 0.1 },
      { x: 120, opacity: 0.22 },
      { x: 320, opacity: 0.5 },
      { x: 700, opacity: 0.85 },
      { x: 1200, opacity: 0.98 },
      { x: 3000, opacity: 1 },
    ],
  },
  {
    id: 'ct-angio',
    label: 'CT-Angio',
    description: '血管造影：增强显影血管（对比剂高值）',
    ww: 800,
    wl: 300,
    color: [
      { x: -1024, r: 0, g: 0, b: 0 },
      { x: -100, r: 0.15, g: 0.05, b: 0.02 },
      { x: 0, r: 0.5, g: 0.2, b: 0.15 },
      { x: 120, r: 0.95, g: 0.7, b: 0.6 },
      { x: 350, r: 1, g: 0.95, b: 0.9 },
      { x: 1200, r: 1, g: 1, b: 1 },
      { x: 3000, r: 1, g: 1, b: 1 },
    ],
    opacity: [
      { x: -1024, opacity: 0 },
      { x: -300, opacity: 0 },
      { x: -50, opacity: 0.06 },
      { x: 0, opacity: 0.18 },
      { x: 110, opacity: 0.6 },
      { x: 320, opacity: 0.95 },
      { x: 1000, opacity: 1 },
      { x: 3000, opacity: 1 },
    ],
  },
  {
    id: 'ct-soft-tissue',
    label: 'CT-Soft-Tissue',
    description: '软组织窗：腹部/颈部软组织为主',
    ww: 400,
    wl: 40,
    color: [
      { x: -1024, r: 0, g: 0, b: 0 },
      { x: -100, r: 0.4, g: 0.25, b: 0.15 },
      { x: 20, r: 0.72, g: 0.6, b: 0.5 },
      { x: 100, r: 0.85, g: 0.78, b: 0.72 },
      { x: 300, r: 0.92, g: 0.9, b: 0.88 },
      { x: 1000, r: 1, g: 1, b: 1 },
    ],
    opacity: [
      { x: -1024, opacity: 0 },
      { x: -100, opacity: 0.02 },
      { x: -40, opacity: 0.2 },
      { x: 0, opacity: 0.45 },
      { x: 60, opacity: 0.55 },
      { x: 300, opacity: 0.48 },
      { x: 1000, opacity: 0.6 },
      { x: 3000, opacity: 0.6 },
    ],
  },
  {
    id: 'ct-skin',
    label: 'CT-Skin',
    description: '皮肤表面：勾勒体表轮廓',
    ww: 400,
    wl: 40,
    color: [
      { x: -1024, r: 0.25, g: 0.12, b: 0.06 },
      { x: -500, r: 0.8, g: 0.6, b: 0.45 },
      { x: -200, r: 0.9, g: 0.78, b: 0.62 },
      { x: 0, r: 0.95, g: 0.85, b: 0.75 },
      { x: 500, r: 1, g: 1, b: 1 },
      { x: 3000, r: 1, g: 1, b: 1 },
    ],
    opacity: [
      { x: -1024, opacity: 0 },
      { x: -600, opacity: 0 },
      { x: -300, opacity: 0.5 },
      { x: -100, opacity: 0.72 },
      { x: 0, opacity: 0.8 },
      { x: 300, opacity: 0.8 },
      { x: 3000, opacity: 0.8 },
    ],
  },
  {
    id: 'mip',
    label: 'MIP',
    description: '最大密度投影：线性灰阶，忽略低值',
    ww: 1500,
    wl: 600,
    color: [
      { x: -1024, r: 0.05, g: 0.05, b: 0.05 },
      { x: 0, r: 0.2, g: 0.2, b: 0.2 },
      { x: 300, r: 0.42, g: 0.42, b: 0.42 },
      { x: 1000, r: 0.75, g: 0.75, b: 0.75 },
      { x: 3000, r: 1, g: 1, b: 1 },
    ],
    opacity: [
      { x: -1024, opacity: 0 },
      { x: -100, opacity: 0 },
      { x: 0, opacity: 0.03 },
      { x: 120, opacity: 0.08 },
      { x: 300, opacity: 0.16 },
      { x: 1000, opacity: 0.35 },
      { x: 3000, opacity: 0.55 },
    ],
  },
]);

const PRESET_BY_ID = new Map(VOLUME3D_PRESETS.map((preset) => [preset.id, preset]));

export interface Volume3dPresetValidation {
  valid: boolean;
  errors: readonly string[];
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function isStrictlyAscending(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! <= values[i - 1]!) {
      return false;
    }
  }
  return true;
}

/**
 * 预设合法性校验（纯函数，供单测）：
 * - id/label 非空；颜色节点 ≥ 2、不透明度节点 ≥ 2；
 * - 各自 x 严格升序且落在 [PRESET_SCALAR_MIN, PRESET_SCALAR_MAX]；
 * - 颜色通道与不透明度 ∈ [0,1]；竟全部数值有限；窗宽 > 0。
 */
export function validateVolume3dPreset(preset: Volume3dPreset): Volume3dPresetValidation {
  const errors: string[] = [];
  const push = (message: string) => errors.push(message);

  if (typeof preset.id !== 'string' || preset.id.trim() === '') {
    push('id 不能为空');
  }
  if (typeof preset.label !== 'string' || preset.label.trim() === '') {
    push('label 不能为空');
  }
  if (!finite(preset.ww) || preset.ww <= 0) {
    push('ww 必须为正数');
  }
  if (!finite(preset.wl)) {
    push('wl 必须为有限数');
  }

  if (preset.color.length < 2) {
    push('颜色传递函数至少需要 2 个节点');
  } else {
    if (!preset.color.every((node) => finite(node.x) && finite(node.r) && finite(node.g) && finite(node.b))) {
      push('颜色节点存在非有限数值');
    }
    if (preset.color.some((node) => node.x < PRESET_SCALAR_MIN || node.x > PRESET_SCALAR_MAX)) {
      push('颜色节点 x 超出标度范围');
    }
    if (preset.color.some((node) => node.r < 0 || node.r > 1 || node.g < 0 || node.g > 1 || node.b < 0 || node.b > 1)) {
      push('颜色通道超出了 [0,1]');
    }
    if (!isStrictlyAscending(preset.color.map((node) => node.x))) {
      push('颜色节点 x 必须严格升序');
    }
  }

  if (preset.opacity.length < 2) {
    push('不透明度传递函数至少需要 2 个节点');
  } else {
    if (!preset.opacity.every((node) => finite(node.x) && finite(node.opacity))) {
      push('不透明度节点存在非有限数值');
    }
    if (preset.opacity.some((node) => node.opacity < 0 || node.opacity > 1)) {
      push('不透明度超出 [0,1]');
    }
    if (!isStrictlyAscending(preset.opacity.map((node) => node.x))) {
      push('不透明度节点 x 必须严格升序');
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 全部内置预设一次性校验（供单测与启动期断言） */
export function validateAllVolume3dPresets(): Volume3dPresetValidation {
  const errors: string[] = [];
  for (const preset of VOLUME3D_PRESETS) {
    const result = validateVolume3dPreset(preset);
    if (!result.valid) {
      errors.push(`${preset.id}: ${result.errors.join('; ')}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** 按 id 查找预设；未命中返回 undefined */
export function findVolume3dPreset(id: string): Volume3dPreset | undefined {
  return PRESET_BY_ID.get(id);
}