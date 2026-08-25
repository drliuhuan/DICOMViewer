/**
 * M1 验收缺陷回归：布局切换后按容器尺寸重排图像。
 *
 * 背景：Cornerstone3D 仅在 enableElement 时按元素当时尺寸设置 canvas，
 * 布局网格（1×1 → 1×2 → 2×2）切换只改变 CSS 尺寸，图像被拉伸变形。
 * 修复：DicomViewport 挂载时用 ResizeObserver 观察容器，回调经 rAF
 * 防抖后调用 renderingEngine.resize(immediate=true, keepCamera=true)，
 * 保持纵横比与用户缩放/平移状态；卸载时 disconnect。
 *
 * 本文件 mock @cornerstonejs/core 与渲染管线初始化（jsdom 无 WebGL），
 * 锁定：RO 创建/observe/disconnect、resize 参数含 keepCamera=true、
 * 连续回调合并为一次 resize、以及 keepCamera 下不重置相机。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const { getRenderingEngineMock } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'cornerstonetoolsstackviewportscroll',
      VOI_MODIFIED: 'cornerstonevoimodified',
      CAMERA_MODIFIED: 'cornerstonecameramodified',
    },
  },
  RenderingEngine: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  cache: {},
  utilities: { scroll: vi.fn(), transformWorldToIndex: vi.fn() },
  getRenderingEngine: getRenderingEngineMock,
}));

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

vi.mock('../src/features/viewer/toolSetup', () => ({
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: vi.fn(() => ({ id: 'fake-tool-group' })),
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

import { DicomViewport } from '../src/features/viewer/DicomViewport';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
  trigger(): void {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

function makeFakeEngine() {
  const fakeViewport = {
    setStack: vi.fn(async () => undefined),
    render: vi.fn(),
    setProperties: vi.fn(),
    getProperties: vi.fn(() => ({ voiRange: { lower: -400, upper: 400 } })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    getActors: vi.fn(() => [] as Array<{ uid: string }>),
    removeAllActors: vi.fn(),
  };
  const engine = {
    enableElement: vi.fn(),
    disableElement: vi.fn(),
    getViewport: vi.fn(() => fakeViewport),
    resize: vi.fn(),
  };
  return { engine, fakeViewport };
}

/** 手动驱动 rAF（避免依赖 jsdom 的 16ms 定时） */
let rafCallbacks: Array<() => void>;
function flushRaf(): void {
  const pending = rafCallbacks;
  rafCallbacks = [];
  for (const cb of pending) {
    cb();
  }
}

describe('DicomViewport 容器尺寸自适应（ResizeObserver + keepCamera resize）', () => {
  let observerInstances: ResizeObserverMock[];

  beforeEach(() => {
    observerInstances = ResizeObserverMock.instances = [];
    rafCallbacks = [];
    vi.stubGlobal(
      'ResizeObserver',
      ResizeObserverMock as unknown as typeof ResizeObserver,
    );
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function firstObserver(): ResizeObserverMock {
    const observer = observerInstances[0];
    if (!observer) {
      throw new Error('ResizeObserver 未创建');
    }
    return observer;
  }

  async function mountViewport() {
    const { engine, fakeViewport } = makeFakeEngine();
    getRenderingEngineMock.mockReturnValue(engine);
    let api: unknown;
    const view = render(
      <DicomViewport
        viewportId="vp-0"
        items={[]}
        showInfo={false}
        onApiReady={(value) => {
          api = value;
        }}
      />,
    );
    // 挂载 effect → 异步管线初始化 → enableElement → pipelineReady
    await act(async () => {
      await Promise.resolve();
    });
    expect(api).toBeDefined();
    return { view, engine, fakeViewport };
  }

  it('挂载时创建 ResizeObserver 并观察 cornerstone-element 容器', async () => {
    await mountViewport();
    expect(observerInstances).toHaveLength(1);
    const observer = firstObserver();
    expect(observer.observe).toHaveBeenCalledTimes(1);
    const observed = observer.observe.mock.calls[0]?.[0] as Element | undefined;
    expect(observed?.classList.contains('cornerstone-element')).toBe(true);
  });

  it('卸载时断开 ResizeObserver', async () => {
    const { view } = await mountViewport();
    const observer = firstObserver();
    expect(observer.disconnect).not.toHaveBeenCalled();
    view.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('容器尺寸变化回调触发 engine.resize(true, true)（immediate + keepCamera）', async () => {
    const { engine } = await mountViewport();
    firstObserver().trigger();
    expect(rafCallbacks).toHaveLength(1);
    await act(async () => {
      flushRaf();
      await Promise.resolve();
    });
    expect(engine.resize).toHaveBeenCalledTimes(1);
    expect(engine.resize).toHaveBeenCalledWith(true, true); // immediate + keepCamera
  });

  it('rAF 防抖：布局动画期间连续多次回调只执行一次 resize', async () => {
    const { engine } = await mountViewport();
    const observer = firstObserver();
    observer.trigger();
    observer.trigger();
    observer.trigger();
    expect(rafCallbacks).toHaveLength(1);
    await act(async () => {
      flushRaf();
      await Promise.resolve();
    });
    expect(engine.resize).toHaveBeenCalledTimes(1);
    // 下一帧后的新回调可再次调度（持续响应尺寸变化）
    observer.trigger();
    expect(rafCallbacks).toHaveLength(1);
  });

  it('keepCamera：resize 后不重置用户缩放/平移（引擎内部以 prevCamera 恢复）', async () => {
    const { engine, fakeViewport } = await mountViewport();
    firstObserver().trigger();
    await act(async () => {
      flushRaf();
      await Promise.resolve();
    });
    expect(getRenderingEngineMock).toHaveBeenCalledWith('dicom-viewer-m1-engine');
    expect(engine.resize).toHaveBeenCalledWith(true, true);
    // 组件侧不得调用 resetCamera 抵消 keepCamera 语义
    expect(fakeViewport.resetCamera).not.toHaveBeenCalled();
  });

  it('resize 抛错（引擎销毁竞态）时静默吞掉且不阻塞后续调度', async () => {
    const { engine } = await mountViewport();
    engine.resize.mockImplementation(() => {
      throw new Error('engine destroyed');
    });
    firstObserver().trigger();
    await act(async () => {
      flushRaf();
      await Promise.resolve();
    });
    expect(engine.resize).toHaveBeenCalledTimes(1);
    expect(rafCallbacks).toHaveLength(0); // 已消费且回调未抛错
    // 恢复正常后继续响应
    engine.resize.mockImplementation(() => {});
    firstObserver().trigger();
    await act(async () => {
      flushRaf();
      await Promise.resolve();
    });
    expect(engine.resize).toHaveBeenCalledTimes(2);
  });
});
