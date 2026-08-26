/**
 * MPR 布局状态机（FR-6.9，M10-B）。
 *
 * 「单轴向 ⇄ 三平面」一键切换：进入时锁定当前激活序列并快照 2D 布局的
 * 视口个数（切回时原样还原 2D 网格，保留加载状态）；退出时清空序列锁定。
 * 三平面视口 id 恒为 {mpr-axial, mpr-coronal, mpr-sagittal}，与 2D 网格
 * 的 vp-N 命名空间隔离，二者共用同一 RenderingEngine（见 MprViewport）。
 *
 * 全部纯函数，可在 Node 下单元测试。
 */

/** MPR 开合状态以及锁定的序列/2D 布局快照 */
export interface MprLayoutState {
  mode: 'off' | 'on';
  /** MPR 期间锁定的序列 UID（off 时恒为 null） */
  seriesUid: string | null;
  /** 进入 MPR 时的 2D 视口个数快照（1/2/4），切回时用于还原布局 */
  prev2dCells: number;
}

export const MPR_2D_LAYOUT_CELLS = [1, 2, 4] as const;

/** 三平面视口 id（顺序 = 轴向/冠状/矢状） */
export const MPR_VIEWPORT_IDS = [
  'mpr-axial',
  'mpr-coronal',
  'mpr-sagittal',
] as const;

export type MprPlaneKey = 'axial' | 'coronal' | 'sagittal';

/** MPR 渲染顺序：轴向 → 冠状 → 矢状（医学惯例布局） */
export const MPR_PLANE_ORDER: readonly MprPlaneKey[] = [
  'axial',
  'coronal',
  'sagittal',
];

export function initialMprLayout(): MprLayoutState {
  return { mode: 'off', seriesUid: null, prev2dCells: 1 };
}

export function enterMprLayout(
  state: MprLayoutState,
  seriesUid: string,
  prev2dCells: number,
): MprLayoutState {
  if (state.mode === 'on') {
    return state;
  }
  const cells = MPR_2D_LAYOUT_CELLS.includes(
    prev2dCells as (typeof MPR_2D_LAYOUT_CELLS)[number],
  )
    ? prev2dCells
    : 1;
  return { mode: 'on', seriesUid, prev2dCells: cells };
}

export function exitMprLayout(state: MprLayoutState): MprLayoutState {
  if (state.mode === 'off') {
    return state;
  }
  return { mode: 'off', seriesUid: null, prev2dCells: state.prev2dCells };
}

/** 一键切换：off → 进入三平面；on → 退回 2D 布局 */
export function toggleMprLayout(
  state: MprLayoutState,
  seriesUid: string,
  prev2dCells: number,
): MprLayoutState {
  return state.mode === 'on' ? exitMprLayout(state) : enterMprLayout(state, seriesUid, prev2dCells);
}

/** 视口 id → 平面；非 MPR 视口返回 null */
export function planeForViewportId(viewportId: string): MprPlaneKey | null {
  switch (viewportId) {
    case 'mpr-axial':
      return 'axial';
    case 'mpr-coronal':
      return 'coronal';
    case 'mpr-sagittal':
      return 'sagittal';
    default:
      return null;
  }
}

/** 平面 → 对应视口 id（顺序与 MPR_VIEWPORT_IDS 一致） */
export function viewportIdForPlane(plane: MprPlaneKey): string {
  return MPR_VIEWPORT_IDS[MPR_PLANE_ORDER.indexOf(plane)] as string;
}

/** 视口 id → 平面名（轴向/冠状/矢状）；非 MPR 视口返回「未知平面」 */
export function planeLabelForViewportId(viewportId: string): string {
  const plane = planeForViewportId(viewportId);
  return plane === null ? '未知平面' : mprPlaneLabel(plane);
}

/**
 * 平面 → @cornerstonejs/core Enums.OrientationAxis 键。
 * VolumeViewport 的 defaultOptions.orientation 使用这些值。
 */
export function orientationAxisKeyForPlane(
  plane: MprPlaneKey,
): 'AXIAL' | 'CORONAL' | 'SAGITTAL' {
  switch (plane) {
    case 'axial':
      return 'AXIAL';
    case 'coronal':
      return 'CORONAL';
    case 'sagittal':
      return 'SAGITTAL';
  }
}

export function mprPlaneLabel(plane: MprPlaneKey): string {
  switch (plane) {
    case 'axial':
      return '轴向';
    case 'coronal':
      return '冠状';
    case 'sagittal':
      return '矢状';
  }
}