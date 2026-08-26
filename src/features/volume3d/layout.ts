/**
 * 3D 体绘制布局状态机（FR-7.1 入口/退出；同类 FR-6.9）。
 *
 * 「2D ⇄ 3D」一键切换：进入时锁定当前激活序列并快照 2D 布局视口个数
 * （切回时原样还原 2D 网格，保留加载状态）；退出时清空序列锁定。
 * 3D 视口 id 恒为 vol3d-main，与 2D 网格 vp-N / MPR mpr-* 命名空间隔离，
 * 共用同一 RenderingEngine（见 Volume3dViewport）。
 *
 * 全部纯函数，可在 Node 下单元测试。
 */
import { MPR_2D_LAYOUT_CELLS } from '../mpr/mprLayout';

/** 3D 视口的唯一视口 id */
export const VOLUME3D_VIEWPORT_ID = 'vol3d-main';

/** 3D 开合状态以及锁定的序列/2D 布局快照 */
export interface Volume3dLayoutState {
  mode: 'off' | 'on';
  /** 3D 期间锁定的序列 UID（off 时恒为 null） */
  seriesUid: string | null;
  /** 进入 3D 时的 2D 视口个数快照（1/2/4），切回时用于还原布局 */
  prev2dCells: number;
}

export function initialVolume3dLayout(): Volume3dLayoutState {
  return { mode: 'off', seriesUid: null, prev2dCells: 1 };
}

export function enterVolume3dLayout(
  state: Volume3dLayoutState,
  seriesUid: string,
  prev2dCells: number,
): Volume3dLayoutState {
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

export function exitVolume3dLayout(state: Volume3dLayoutState): Volume3dLayoutState {
  if (state.mode === 'off') {
    return state;
  }
  return { mode: 'off', seriesUid: null, prev2dCells: state.prev2dCells };
}

/** 一键切换：off → 进入 3D；on → 退回 2D 布局 */
export function toggleVolume3dLayout(
  state: Volume3dLayoutState,
  seriesUid: string,
  prev2dCells: number,
): Volume3dLayoutState {
  return state.mode === 'on'
    ? exitVolume3dLayout(state)
    : enterVolume3dLayout(state, seriesUid, prev2dCells);
}