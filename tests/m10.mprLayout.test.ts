/**
 * M10-B MPR 布局状态机（FR-6.9）：单轴向 ⇄ 三平面切换、序列锁定与 2D 布局
 * 快照还原；三平面视口 id / 平面映射 / 方向轴映射。
 */
import { describe, expect, it } from 'vitest';
import {
  MPR_PLANE_ORDER,
  MPR_VIEWPORT_IDS,
  enterMprLayout,
  exitMprLayout,
  initialMprLayout,
  mprPlaneLabel,
  orientationAxisKeyForPlane,
  planeForViewportId,
  planeLabelForViewportId,
  toggleMprLayout,
  viewportIdForPlane,
} from '../src/features/mpr/mprLayout';

describe('初始状态', () => {
  it('默认 off，无锁定序列，2D 快照为 1×1', () => {
    expect(initialMprLayout()).toEqual({
      mode: 'off',
      seriesUid: null,
      prev2dCells: 1,
    });
  });
});

describe('enterMprLayout', () => {
  it('进入三平面：锁定序列 + 快照 2D 视口个数', () => {
    const state = enterMprLayout(initialMprLayout(), '1.2.a', 4);
    expect(state).toEqual({ mode: 'on', seriesUid: '1.2.a', prev2dCells: 4 });
  });

  it('已是 on 态再次进入保持不变（幂等）', () => {
    const state = enterMprLayout(
      { mode: 'on', seriesUid: '1.2.a', prev2dCells: 2 },
      '1.2.b',
      1,
    );
    expect(state).toEqual({ mode: 'on', seriesUid: '1.2.a', prev2dCells: 2 });
  });

  it('非法快照值回退 1×1', () => {
    const state = enterMprLayout(initialMprLayout(), '1.2.a', 9);
    expect(state.prev2dCells).toBe(1);
  });
});

describe('exitMprLayout', () => {
  it('退出：清空锁定序列，保留 2D 快照', () => {
    const state = exitMprLayout({
      mode: 'on',
      seriesUid: '1.2.a',
      prev2dCells: 4,
    });
    expect(state).toEqual({ mode: 'off', seriesUid: null, prev2dCells: 4 });
  });

  it('off 态退出为空操作', () => {
    expect(exitMprLayout(initialMprLayout())).toEqual(initialMprLayout());
  });
});

describe('toggleMprLayout', () => {
  it('off → 进入；on → 退出（一键往返）', () => {
    const entered = toggleMprLayout(initialMprLayout(), '1.2.a', 2);
    expect(entered.mode).toBe('on');
    expect(entered.seriesUid).toBe('1.2.a');
    const exited = toggleMprLayout(entered, '1.2.b', 2);
    expect(exited.mode).toBe('off');
    expect(exited.seriesUid).toBeNull();
    expect(exited.prev2dCells).toBe(2);
  });
});

describe('三平面视口与平面映射', () => {
  it('MPR_VIEWPORT_IDS 与 PLANE_ORDER 一一对应且顺序一致', () => {
    expect(MPR_VIEWPORT_IDS).toHaveLength(3);
    expect(MPR_PLANE_ORDER).toEqual(['axial', 'coronal', 'sagittal']);
    expect(MPR_PLANE_ORDER.map((plane) => viewportIdForPlane(plane))).toEqual([
      ...MPR_VIEWPORT_IDS,
    ]);
  });

  it('视口 id <-> 平面互转', () => {
    expect(planeForViewportId('mpr-axial')).toBe('axial');
    expect(planeForViewportId('mpr-coronal')).toBe('coronal');
    expect(planeForViewportId('mpr-sagittal')).toBe('sagittal');
    expect(planeForViewportId('vp-0')).toBeNull();
    expect(planeLabelForViewportId('mpr-axial')).toBe('轴向');
    expect(planeLabelForViewportId('vp-0')).toBe('未知平面');
  });

  it('平面 → 方向轴键（轴向/冠状/矢状）', () => {
    expect(orientationAxisKeyForPlane('axial')).toBe('AXIAL');
    expect(orientationAxisKeyForPlane('coronal')).toBe('CORONAL');
    expect(orientationAxisKeyForPlane('sagittal')).toBe('SAGITTAL');
    expect(mprPlaneLabel('sagittal')).toBe('矢状');
  });
});