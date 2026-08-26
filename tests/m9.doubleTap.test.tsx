/**
 * M9 触控双击（FR-14.1/FR-3.4：双击=适应窗口，桌面/移动同语义）。
 *
 * Cornerstone 将快速两次轻点合成为 TOUCH_TAP 事件（taps=2，经
 * triggerEvent 以 CustomEvent 派发到视口元素）；DicomViewport 订阅
 * TOUCH_TAP_EVENT，taps=2 时执行与桌面 dblclick 相同的
 * resetCamera(resetPan+resetZoom) + render。
 *
 * 本文件 mock @cornerstonejs/core 与渲染管线（jsdom 无 WebGL，
 * 手法同 m1.viewportResize.test.tsx），锁定：
 * - taps=2 → resetCamera({resetPan:true, resetZoom:true}) + render；
 * - taps=1（单击）/ 无 taps → 不触发适应窗口；
 * - 事件名与真实库枚举一致（touchEvents 常量，防漂移）。
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
      STACK_VIEWPORT_SCROLL: 'cornerstonestackviewportscroll',
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

import { Enums } from '@cornerstonejs/tools';
import { DicomViewport } from '../src/features/viewer/DicomViewport';
import { TOUCH_TAP_EVENT } from '../src/features/viewer/touchEvents';

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

async function mountViewport() {
  const { engine, fakeViewport } = makeFakeEngine();
  getRenderingEngineMock.mockReturnValue(engine);
  const view = render(
    <DicomViewport viewportId="vp-m9" items={[]} showInfo={false} />,
  );
  // 挂载 effect → 异步管线初始化 → enableElement → pipelineReady
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
  });
  const element = view.container.querySelector('.cornerstone-element');
  if (!element) {
    throw new Error('未找到 cornerstone-element 容器');
  }
  return { view, engine, fakeViewport, element: element as HTMLElement };
}

function fireTap(element: HTMLElement, taps: number | undefined): void {
  element.dispatchEvent(
    new CustomEvent(TOUCH_TAP_EVENT, { detail: taps === undefined ? {} : { taps } }),
  );
}

describe('DicomViewport 触控双击适应窗口（FR-14.1）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('事件名与真实库枚举一致（防漂移）', () => {
    expect(TOUCH_TAP_EVENT).toBe(Enums.Events.TOUCH_TAP);
  });

  it('TOUCH_TAP taps=2 → resetCamera(resetPan+resetZoom) + render（适应窗口）', async () => {
    const { fakeViewport, element } = await mountViewport();
    await act(async () => {
      fireTap(element, 2);
    });
    expect(fakeViewport.resetCamera).toHaveBeenCalledTimes(1);
    expect(fakeViewport.resetCamera).toHaveBeenCalledWith({ resetPan: true, resetZoom: true });
    expect(fakeViewport.render).toHaveBeenCalledTimes(1);
  });

  it('TOUCH_TAP taps=1（单击）不触发适应窗口', async () => {
    const { fakeViewport, element } = await mountViewport();
    await act(async () => {
      fireTap(element, 1);
    });
    expect(fakeViewport.resetCamera).not.toHaveBeenCalled();
  });

  it('TOUCH_TAP 无 taps 字段（异常事件）不触发适应窗口', async () => {
    const { fakeViewport, element } = await mountViewport();
    await act(async () => {
      fireTap(element, undefined);
    });
    expect(fakeViewport.resetCamera).not.toHaveBeenCalled();
  });

  it('连续两次 taps=2 → 每次均执行一次适应窗口', async () => {
    const { fakeViewport, element } = await mountViewport();
    await act(async () => {
      fireTap(element, 2);
      fireTap(element, 2);
    });
    expect(fakeViewport.resetCamera).toHaveBeenCalledTimes(2);
  });
});
