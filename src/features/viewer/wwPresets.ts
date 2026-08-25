/**
 * 窗宽窗位预设（FR-3.2/3.3/3.4）。
 *
 * - CT 预设按需求基线：脑 80/40、肺 1500/-600、骨 2500/500、软组织 400/40；
 * - MR 提供一个默认预设；
 * - 文件自带 WindowWidth/WindowCenter 时优先作为该序列默认。
 *
 * WW/WL ↔ VOI range 换算为纯函数，可在 Node 下单元测试。
 */

export interface WwWlPreset {
  id: string;
  label: string;
  /** 窗宽 */
  ww: number;
  /** 窗位 */
  wl: number;
}

/** 预设表（下拉展示顺序） */
export const WW_WL_PRESETS: readonly WwWlPreset[] = [
  { id: 'ct-brain', label: '脑（80/40）', ww: 80, wl: 40 },
  { id: 'ct-lung', label: '肺（1500/-600）', ww: 1500, wl: -600 },
  { id: 'ct-bone', label: '骨（2500/500）', ww: 2500, wl: 500 },
  { id: 'ct-soft-tissue', label: '软组织（400/40）', ww: 400, wl: 40 },
  { id: 'mr-default', label: 'MR 默认（400/40）', ww: 400, wl: 40 },
];

/** 各模态的兜底预设 id（文件未自带窗宽窗位时使用） */
const MODALITY_DEFAULT_PRESET: Readonly<Record<string, string>> = {
  CT: 'ct-soft-tissue',
  MR: 'mr-default',
};

/** 通用兜底（未知模态） */
export const FALLBACK_WW_WL = { ww: 400, wl: 40 } as const;

function clampPositiveWw(ww: number): number {
  return ww > 0 ? ww : FALLBACK_WW_WL.ww;
}

/**
 * 取模态对应的默认 WW/WL；文件自带窗宽窗位优先，其次按模态预设，
 * 最后通用兜底。非法值（非有限数 / 窗宽 ≤ 0）一律回退。
 */
export function getDefaultWwWlForModality(
  modality: string,
  fileWindow?: { windowWidth?: number; windowCenter?: number },
): { ww: number; wl: number } {
  const fileWw = fileWindow?.windowWidth;
  const fileWl = fileWindow?.windowCenter;
  if (
    typeof fileWw === 'number' &&
    Number.isFinite(fileWw) &&
    fileWw > 0 &&
    typeof fileWl === 'number' &&
    Number.isFinite(fileWl)
  ) {
    return { ww: fileWw, wl: fileWl };
  }
  const presetId = MODALITY_DEFAULT_PRESET[modality.toUpperCase()];
  const preset = WW_WL_PRESETS.find((p) => p.id === presetId);
  if (preset) {
    return { ww: preset.ww, wl: preset.wl };
  }
  return { ...FALLBACK_WW_WL };
}

/** 按 id 查找预设。 */
export function findPresetById(id: string): WwWlPreset | undefined {
  return WW_WL_PRESETS.find((preset) => preset.id === id);
}

/** WW/WL → Cornerstone VOI 显示范围。窗宽 ≤ 0 视为非法并回退到通用兜底窗宽。 */
export function voiRangeFromWwWl(
  ww: number,
  wl: number,
): { upper: number; lower: number } {
  const width = clampPositiveWw(Number.isFinite(ww) ? ww : FALLBACK_WW_WL.ww);
  const center = Number.isFinite(wl) ? wl : FALLBACK_WW_WL.wl;
  return {
    upper: center + width / 2,
    lower: center - width / 2,
  };
}

/** Cornerstone VOI 显示范围 → WW/WL。 */
export function wwWlFromVoiRange(range: {
  upper: number;
  lower: number;
}): { ww: number; wl: number } {
  const ww = range.upper - range.lower;
  const wl = (range.upper + range.lower) / 2;
  return {
    ww: Math.round(ww * 100) / 100,
    wl: Math.round(wl * 100) / 100,
  };
}
