/**
 * M10-C 3D 布局状态机（FR-7.1 入口/退出，同类 FR-6.9）：
 * 2D ⇄ 3D 一键切换、序列锁定、2D 视口个数快照还原。
 */
import { describe, expect, it } from 'vitest';
import {
  enterVolume3dLayout,
  exitVolume3dLayout,
  initialVolume3dLayout,
  toggleVolume3dLayout,
} from '../src/features/volume3d/layout';

describe('initialVolume3dLayout', () => {
  it('初始为 off，无锁定序列，快照 1 个视口', () => {
    expect(initialVolume3dLayout()).toEqual({ mode: 'off', seriesUid: null, prev2dCells: 1 });
  });
});

describe('enterVolume3dLayout', () => {
  it('进入：锁定序列 + 快照当前 2D 视口个数', () => {
    const state = enterVolume3dLayout(initialVolume3dLayout(), '1.2.s', 2);
    expect(state).toEqual({ mode: 'on', seriesUid: '1.2.s', prev2dCells: 2 });
  });

  it('已在 on 状态时重复进入不变', () => {
    const on = enterVolume3dLayout(initialVolume3dLayout(), '1.2.s', 4);
    expect(enterVolume3dLayout(on, '1.2.other', 1)).toBe(on);
  });

  it('非法快照值回退为 1（不支持的布局档）', () => {
    expect(enterVolume3dLayout(initialVolume3dLayout(), '1.2.s', 7).prev2dCells).toBe(1);
  });
});

describe('exitVolume3dLayout / toggleVolume3dLayout', () => {
  it('退出：清空锁定，保留 2D 快照', () => {
    const on = enterVolume3dLayout(initialVolume3dLayout(), '1.2.s', 4);
    expect(exitVolume3dLayout(on)).toEqual({ mode: 'off', seriesUid: null, prev2dCells: 4 });
  });

  it('toggle：off → on → off', () => {
    const first = toggleVolume3dLayout(initialVolume3dLayout(), '1.2.s', 2);
    expect(first.mode).toBe('on');
    expect(first.seriesUid).toBe('1.2.s');
    const second = toggleVolume3dLayout(first, '1.2.other', 2);
    expect(second.mode).toBe('off');
    expect(second.prev2dCells).toBe(2);
  });
});