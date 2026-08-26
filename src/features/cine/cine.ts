/**
 * Cine 播放纯逻辑与状态机（FR-3.8，M10-E）。
 *
 * 模块顶层不依赖任何 DOM / cornerstone 全局：帧推进算法、
 * 播放/暂停/停止状态转换、循环环绕与到达末尾自动停止全部在此实现，
 * 可在 Node 下用假定时器单测。浏览器运行时由 App 装配 CinePlayer，
 * 注射 getFrameCount / getCurrentIndex / onFrame / onStateChange 回调。
 *
 * UI 语义：
 * - play()：从当前帧继续播放；pause()：暂停并保留当前帧；
 * - stop()：暂停并把帧复位到首帧（0）；
 * - loop=true 时到达末尾环绕到首帧（或 backward 环绕到末帧）；
 * - loop=false 时到达末尾自动停止（停留末帧）。
 */

export const CINE_FPS_MIN = 1;
export const CINE_FPS_MAX = 30;
export const CINE_DEFAULT_FPS = 10;

/** 帧率收敛到合法区间（1–30 fps，需求清单 FR-3.8 上限 30） */
export function clampCineFps(fps: number): number {
  if (!Number.isFinite(fps)) {
    return CINE_DEFAULT_FPS;
  }
  return Math.min(CINE_FPS_MAX, Math.max(CINE_FPS_MIN, Math.round(fps)));
}

export type CineDirection = 1 | -1;

/**
 * 计算下一帧索引（纯函数）。
 *
 * - 单帧/空序列：不前进（返回当前帧）；frameCount<=1 时返回 clamp 后的索引。
 * - 出界时：loop=true 环绕到另一端；loop=false 返回 null（调用方应停止播放）。
 * - direction=1 前进、-1 后退。
 */
export function nextCineIndex(
  currentIndex: number,
  frameCount: number,
  direction: CineDirection,
  loop: boolean,
): number | null {
  if (frameCount <= 1) {
    return Math.max(0, Math.min(frameCount - 1, Math.max(0, currentIndex)));
  }
  const next = currentIndex + direction;
  if (next >= 0 && next < frameCount) {
    return next;
  }
  if (loop) {
    return direction > 0 ? 0 : frameCount - 1;
  }
  return null;
}

/** 宿主回调集合（全部由 App/组件注入，避免本模块耦合视口） */
export interface CinePlayerHooks {
  /** 当前序列的总帧数（多层/多帧） */
  getFrameCount(): number;
  /** 当前帧索引（驱动层滑块联动，用户播放中拖动滑块时实时跟随） */
  getCurrentIndex(): number;
  /** 推进帧：宿主把视口切到指定索引 */
  onFrame(index: number): void;
  /** 状态变化通知（供工具栏按钮/滑块 UI 同步） */
  onStateChange?(state: CineUiState): void;
}

export interface CineUiState {
  playing: boolean;
  fps: number;
  loop: boolean;
  reverse: boolean;
}

/**
 * 播放/暂停/停止状态机 + 定时驱动（FR-3.8）。
 *
 * 播放内部用 setInterval 以 `1000 / fps` 毫秒推进；帧推进前实时读取宿主的
 * 当前帧/总帧数，因此用户播放期间拖动层滑块（或外部改帧）不会跳变。
 * reverse 控制反向播放（CineDirection 反转）。
 */
export class CinePlayer {
  playing = false;
  fps = CINE_DEFAULT_FPS;
  loop = true;
  reverse = false;

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly hooks: CinePlayerHooks;

  constructor(
    hooks: CinePlayerHooks,
    options?: { fps?: number; loop?: boolean; reverse?: boolean },
  ) {
    this.hooks = hooks;
    if (options?.fps !== undefined) {
      this.fps = clampCineFps(options.fps);
    }
    if (options?.loop !== undefined) {
      this.loop = options.loop;
    }
    if (options?.reverse !== undefined) {
      this.reverse = options.reverse;
    }
  }

  get direction(): CineDirection {
    return this.reverse ? -1 : 1;
  }

  /** 从当前帧开始/继续播放；已在播放则无副作用 */
  play(): void {
    if (this.playing) {
      this.notify();
      return;
    }
    this.playing = true;
    this.startTimer();
    this.notify();
  }

  /** 暂停：保留当前帧 */
  pause(): void {
    if (!this.playing && this.timer === null) {
      return;
    }
    this.playing = false;
    this.clearTimer();
    this.notify();
  }

  /** 停止：暂停并把帧复位到首帧（0） */
  stop(): void {
    this.pause();
    try {
      this.hooks.onFrame(0);
    } catch {
      // 视口未就绪等瞬态：忽略
    }
    this.notify();
  }

  /** 播放/暂停切换（工具栏空格键语义） */
  togglePlay(): void {
    if (this.playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** 调整播放速度（帧/秒）：播放中立即以新节奏推进 */
  setFps(fps: number): void {
    const next = clampCineFps(fps);
    if (next === this.fps) {
      return;
    }
    this.fps = next;
    if (this.playing) {
      this.clearTimer();
      this.startTimer();
    }
    this.notify();
  }

  setLoop(loop: boolean): void {
    if (loop === this.loop) {
      return;
    }
    this.loop = loop;
    this.notify();
  }

  setReverse(reverse: boolean): void {
    if (reverse === this.reverse) {
      return;
    }
    this.reverse = reverse;
    this.notify();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** 释放定时器（组件卸载/退出模式时调用） */
  destroy(): void {
    this.clearTimer();
  }

  private tick(): void {
    const frameCount = this.hooks.getFrameCount();
    if (frameCount <= 0) {
      // 序列已清空：自动停止
      this.pause();
      return;
    }
    const current = this.hooks.getCurrentIndex();
    const next = nextCineIndex(current, frameCount, this.direction, this.loop);
    if (next === null) {
      // 非循环到达末尾：自动停止（停留当前帧）
      this.playing = false;
      this.clearTimer();
      this.notify();
      return;
    }
    if (next !== current) {
      try {
        this.hooks.onFrame(next);
      } catch {
        this.pause();
      }
    }
  }

  private startTimer(): void {
    this.clearTimer();
    const periodMs = Math.max(1, 1000 / this.fps);
    this.timer = globalThis.setInterval(() => this.tick(), periodMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      globalThis.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private notify(): void {
    this.hooks.onStateChange?.({
      playing: this.playing,
      fps: this.fps,
      loop: this.loop,
      reverse: this.reverse,
    });
  }
}