/**
 * M10-E Cine 播放状态机单测（FR-3.8）。
 * 纯逻辑：帧推进 / 循环环绕 / 非循环自动停止 / 播放-暂停-停止转换 /
 * 帧率控制 / 反向播放。CinePlayer 使用假定时器驱动。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CINE_DEFAULT_FPS,
  CinePlayer,
  clampCineFps,
  nextCineIndex,
} from '../src/features/cine/cine';

describe('nextCineIndex（帧推进纯函数）', () => {
  it('范围内前进/后退', () => {
    expect(nextCineIndex(3, 10, 1, true)).toBe(4);
    expect(nextCineIndex(3, 10, -1, true)).toBe(2);
  });

  it('循环模式下到达末尾环绕（loop=true）', () => {
    expect(nextCineIndex(9, 10, 1, true)).toBe(0);
    expect(nextCineIndex(0, 10, -1, true)).toBe(9);
  });

  it('非循环模式到达边界返回 null（自动停止信号）', () => {
    expect(nextCineIndex(9, 10, 1, false)).toBeNull();
    expect(nextCineIndex(0, 10, -1, false)).toBeNull();
  });

  it('单帧/空序列不前进', () => {
    expect(nextCineIndex(0, 1, 1, true)).toBe(0);
    expect(nextCineIndex(-1, 0, 1, false)).toBe(0);
  });
});

describe('clampCineFps', () => {
  it('收敛到 1–30 帧/秒', () => {
    expect(clampCineFps(5)).toBe(5);
    expect(clampCineFps(0)).toBe(1);
    expect(clampCineFps(99)).toBe(30);
    expect(clampCineFps(Number.NaN)).toBe(CINE_DEFAULT_FPS);
    expect(clampCineFps(12.6)).toBe(13);
  });
});

describe('CinePlayer 播放/暂停/停止状态机', () => {
  let hooks: {
    getFrameCount: ReturnType<typeof vi.fn>;
    getCurrentIndex: ReturnType<typeof vi.fn>;
    onFrame: ReturnType<typeof vi.fn>;
    onStateChange: ReturnType<typeof vi.fn>;
  };
  let player: CinePlayer;

  beforeEach(() => {
    vi.useFakeTimers();
    hooks = {
      getFrameCount: vi.fn(() => 10),
      getCurrentIndex: vi.fn(() => 0),
      onFrame: vi.fn(),
      onStateChange: vi.fn(),
    };
    player = new CinePlayer(hooks, { fps: 10, loop: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('play() 以帧率推进帧并通知状态', () => {
    let current = 0;
    hooks.getCurrentIndex.mockImplementation(() => current);
    hooks.onFrame.mockImplementation((index: number) => {
      current = index;
    });
    player.play();
    expect(player.isPlaying()).toBe(true);
    expect(hooks.onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ playing: true }),
    );
    vi.advanceTimersByTime(1000); // 10fps → 10 次 tick
    expect(hooks.onFrame).toHaveBeenCalledTimes(10);
    // 播放中当前帧变化（滑块联动），后续 tick 从新值继续
    expect(hooks.onFrame.mock.calls[0]?.[0]).toBe(1);
    expect(current).toBe(0); // 循环播放环绕回首帧
  });

  it('pause() 停止推进并保留当前帧', () => {
    player.play();
    vi.advanceTimersByTime(300);
    const ticked = hooks.onFrame.mock.calls.length;
    player.pause();
    const frozen = hooks.onFrame.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(hooks.onFrame.mock.calls.length).toBe(frozen);
    expect(ticked).toBeGreaterThan(0);
    expect(player.isPlaying()).toBe(false);
  });

  it('stop() 暂停并把帧复位到首帧', () => {
    player.play();
    vi.advanceTimersByTime(500);
    player.stop();
    expect(player.isPlaying()).toBe(false);
    expect(hooks.onFrame).toHaveBeenLastCalledWith(0);
    vi.advanceTimersByTime(1000);
    expect(hooks.onFrame).toHaveBeenLastCalledWith(0); // 不再推进
  });

  it('非循环播放到达末尾自动停止', () => {
    player.setLoop(false);
    player.play();
    // 从 0 前进 9 帧到 9，再 tick 一次到达末尾 → null → 停止
    hooks.getCurrentIndex.mockReturnValue(9);
    vi.advanceTimersByTime(1000);
    expect(player.isPlaying()).toBe(false);
    expect(hooks.onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ playing: false, loop: false }),
    );
  });

  it('setFps 立即改变播放节奏', () => {
    player.play();
    vi.advanceTimersByTime(500);
    player.setFps(20);
    const before = hooks.onFrame.mock.calls.length;
    vi.advanceTimersByTime(500);
    const after = hooks.onFrame.mock.calls.length;
    // 20fps 下 500ms ≈ 10 tick（新节奏）
    expect(after - before).toBeGreaterThanOrEqual(9);
  });

  it('reverse=true 反向播放', () => {
    player.setReverse(true);
    hooks.getCurrentIndex.mockReturnValue(9);
    player.play();
    vi.advanceTimersByTime(1000);
    expect(hooks.onFrame.mock.calls[0]?.[0]).toBe(8);
  });

  it('序列清空（frameCount=0）时自动停止', () => {
    hooks.getFrameCount.mockReturnValue(0);
    player.play();
    vi.advanceTimersByTime(200);
    expect(player.isPlaying()).toBe(false);
  });

  it('togglePlay 播放<->暂停往返', () => {
    player.togglePlay();
    expect(player.isPlaying()).toBe(true);
    player.togglePlay();
    expect(player.isPlaying()).toBe(false);
  });

  it('destroy 释放定时器', () => {
    player.play();
    player.destroy();
    vi.advanceTimersByTime(1000);
    expect(hooks.onFrame).not.toHaveBeenCalled();
  });
});