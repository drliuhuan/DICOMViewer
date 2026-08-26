/**
 * MPR 厚度模式参数计算（FR-6.4，M10-B）。
 *
 * 三种重建模式 → Metro 3D 对应 BlendModes 键：
 * - Average（平均强度投影）→ AVERAGE_INTENSITY_BLEND
 * - MIP（最大密度投影）→ MAXIMUM_INTENSITY_BLEND
 * - MINIP（最小密度投影）→ MINIMUM_INTENSITY_BLEND
 * 厚度 1–100mm 可调，越界时钳制。
 *
 * 全部纯函数（不依赖 @cornerstonejs/core 的运行时常量，便于 Node 单测）；
 * 具体 BlendModes 枚举值由调用方（MprViewport）经
 * Enums.BlendModes[blendModeKey] 解析。
 */

export type MprThicknessMode = 'AVERAGE' | 'MIP' | 'MINIP';

export type MprBlendModeKey =
  | 'AVERAGE_INTENSITY_BLEND'
  | 'MAXIMUM_INTENSITY_BLEND'
  | 'MINIMUM_INTENSITY_BLEND';

export const MPR_THICKNESS_MIN = 1;
export const MPR_THICKNESS_MAX = 100;

/** 默认重建模式：平均强度投影（医学阅片默认） */
export const MPR_DEFAULT_THICKNESS_MODE: MprThicknessMode = 'AVERAGE';

/** 默认厚度（mm）：单帧等效的 1mm 最小厚度，避免误启 MIP 厚层 */
export const MPR_DEFAULT_THICKNESS = 1;

/** 重建模式 → BlendModes 枚举键（供上方 Enums.BlendModes 映射） */
export const BLEND_MODE_KEYS: Readonly<Record<MprThicknessMode, MprBlendModeKey>> = {
  AVERAGE: 'AVERAGE_INTENSITY_BLEND',
  MIP: 'MAXIMUM_INTENSITY_BLEND',
  MINIP: 'MINIMUM_INTENSITY_BLEND',
};

/** UI 模式选项（简体中文） */
export const MPR_THICKNESS_MODES: readonly {
  id: MprThicknessMode;
  label: string;
}[] = [
  { id: 'AVERAGE', label: '平均' },
  { id: 'MIP', label: 'MIP' },
  { id: 'MINIP', label: 'MinIP' },
];

/** 厚度越界钳制到 [1, 100]mm；NaN 回退最小厚度，±Infinity 按符号钳制 */
export function clampThickness(
  thickness: number,
  min = MPR_THICKNESS_MIN,
  max = MPR_THICKNESS_MAX,
): number {
  if (Number.isNaN(thickness)) {
    return min;
  }
  if (!Number.isFinite(thickness)) {
    return thickness > 0 ? max : min;
  }
  return Math.min(max, Math.max(min, Math.round(thickness * 10) / 10));
}

/**
 * 计算视口渲染参数：blendMode 键 + 钳制后的 slab 厚度（mm）。
 * 注：仅当 thickness > 1（或显式 MIP/MinIP）时启用厚层重建；
 * 厚度 = 1 恒为单层 Average 语义（等价普通薄层渲染）。
 */
export function thicknessParams(
  mode: MprThicknessMode,
  thickness: number,
): { blendModeKey: MprBlendModeKey; slabThickness: number } {
  const slabThickness = clampThickness(thickness);
  if (mode === 'AVERAGE' && slabThickness <= MPR_THICKNESS_MIN) {
    return { blendModeKey: 'AVERAGE_INTENSITY_BLEND', slabThickness };
  }
  return { blendModeKey: BLEND_MODE_KEYS[mode], slabThickness };
}