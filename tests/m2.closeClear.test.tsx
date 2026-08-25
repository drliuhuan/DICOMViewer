/**
 * M2-I App 集成：序列卡片 × 关闭单个序列、工具栏「清空全部」二次确认。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

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
  // 空 cache 桩：release 管线内部对缺失方法有 try/catch 保护
  cache: {},
  utilities: { scroll: vi.fn(), transformWorldToIndex: vi.fn() },
  getRenderingEngine: getRenderingEngineMock,
}));

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

const createBoundToolGroupMock = vi.hoisted(() =>
  vi.fn((_: string, viewportId: string) => ({ id: `tg-${viewportId}` })),
);

vi.mock('../src/features/viewer/toolSetup', () => ({
  ToolNames: {
    windowLevel: 'WindowLevel',
    zoom: 'Zoom',
    pan: 'Pan',
    stackScroll: 'StackScroll',
    length: 'Length',
    angle: 'Angle',
    rectangleRoi: 'RectangleROI',
    ellipticalRoi: 'EllipticalROI',
    probe: 'Probe',
  },
  PLACEHOLDER_MEASUREMENT_TOOLS: ['Length', 'Angle', 'RectangleROI', 'EllipticalROI', 'Probe'],
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: createBoundToolGroupMock,
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

const openDicomFilesMock = vi.hoisted(() => vi.fn());

vi.mock('../src/features/loading/openDicomFiles', () => ({
  openDicomFiles: openDicomFilesMock,
}));

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

function makeOpenedFile(seriesUid: string, sopInstanceUid: string) {
  return {
    fileName: `${seriesUid}.dcm`,
    fileSizeBytes: 128,
    baseImageId: `dcm-file://${seriesUid}`,
    summary: {
      patientName: '张^三',
      patientId: 'P1',
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: '1.2.study',
      studyDate: undefined,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: seriesUid,
      seriesNumber: 1,
      seriesDescription: seriesUid === '1.2.a' ? '肺窗' : '骨窗',
      instanceNumber: 1,
      sliceLocation: undefined,
      sliceThickness: undefined,
      pixelSpacing: undefined,
      imagePositionPatient: undefined,
      imageOrientationPatient: undefined,
      perFrameImagePositions: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 8,
      columns: 8,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: undefined,
      sopInstanceUid,
      transferSyntaxUid: undefined,
    },
  };
}

function makeViewportStub() {
  // 有状态桩：setStack 添加堆栈 actor，removeAllActors 移除，
  // 与 @cornerstonejs/core 实际语义一致（getActors 反映当前渲染体）
  let actors: Array<{ uid: string }> = [];
  return {
    setStack: vi.fn(async () => {
      actors = [{ uid: 'stack-actor' }];
    }),
    render: vi.fn(),
    setProperties: vi.fn(),
    getProperties: vi.fn(() => ({ voiRange: { lower: -400, upper: 400 } })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    getActors: vi.fn(() => actors),
    removeAllActors: vi.fn(() => {
      actors = [];
    }),
  };
}

async function settle(rounds = 10): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

describe('数据集关闭与清空（App 集成，FR-2.9）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    openDicomFilesMock.mockResolvedValue({
      opened: [
        makeOpenedFile('1.2.a', '1.2.sop-a'),
        makeOpenedFile('1.2.b', '1.2.sop-b'),
      ],
      failures: [],
      cancelled: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderLoaded() {
    const { default: App } = await import('../src/app/App');
    // 按 viewportId 稳定缓存 viewport 桩，便于断言清空调用
    const viewports: Record<string, ReturnType<typeof makeViewportStub>> = {};
    getRenderingEngineMock.mockReturnValue({
      enableElement: vi.fn((options: { viewportId: string }) => options),
      disableElement: vi.fn(),
      getViewport: vi.fn((viewportId: string) => {
        return (viewports[viewportId] ??= makeViewportStub());
      }),
      resize: vi.fn(),
    });
    const view = await act(async () => render(<App />));
    await act(async () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], files: [new File([], 'a')] },
      });
      window.dispatchEvent(event);
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }
    });
    return { view, viewports };
  }

  function findButton(container: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!button) {
      throw new Error(`button not found: ${text}`);
    }
    return button;
  }

  it('点击卡片 × 关闭该序列：面板移除且另一序列保留；视口图像清空', async () => {
    const { view, viewports } = await renderLoaded();
    expect(view.container.querySelectorAll('.series-item')).toHaveLength(2);
    // vp-0 自动加载了首个序列（1.2.a），角标可见
    expect(view.container.querySelector('.vp-0-badge') ?? view.container.querySelector('.viewport-badge')).not.toBeNull();

    fireEvent.click(view.container.querySelectorAll('.series-item-close')[0]!);
    await settle();

    const cards = view.container.querySelectorAll('.series-item');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain('骨窗');
    // 被关闭序列所在视口的角标消失（未再指派）
    expect(view.container.textContent).toContain('已关闭序列并释放内存');
    // FR-2.9 缺陷修复：vp-0 视口图像被清空（removeAllActors + render）；
    // 1×1 布局下 vp-1 未挂载，自然不受影响
    const vp0 = viewports['vp-0'];
    expect(vp0).toBeDefined();
    expect(vp0?.removeAllActors).toHaveBeenCalledTimes(1);
    expect(vp0?.render).toHaveBeenCalled();
    expect(viewports['vp-1']).toBeUndefined();
  });

  it('「清空全部」确认后清空面板与状态；取消则不动作', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');

    // 取消分支
    confirmSpy.mockReturnValue(false);
    const { view, viewports } = await renderLoaded();
    fireEvent.click(findButton(view.container, '清空全部'));
    await settle();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(view.container.querySelectorAll('.series-item')).toHaveLength(2);

    // 确认分支
    confirmSpy.mockReturnValue(true);
    fireEvent.click(findButton(view.container, '清空全部'));
    await settle();

    expect(view.container.querySelectorAll('.series-item')).toHaveLength(0);
    expect(view.container.textContent).toContain('已清空全部数据');
    expect(view.container.querySelector('.series-panel')).toBeNull();
    // releaseAll 路径：所有视口 assignments 置 null → vp-0 视口图像同样被清空
    expect(viewports['vp-0']?.removeAllActors).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('关闭后重新打开同一文件不被去重拦截（UID 标记已撤销）', async () => {
    const { view } = await renderLoaded();

    fireEvent.click(view.container.querySelectorAll('.series-item-close')[0]!);
    await settle();
    expect(view.container.querySelectorAll('.series-item')).toHaveLength(1);

    // 再次 drop 同一批文件：sop-a 的去重标记已被撤销，可重新加载
    await act(async () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], files: [new File([], 'a')] },
      });
      window.dispatchEvent(event);
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }
    });
    expect(view.container.querySelectorAll('.series-item')).toHaveLength(2);
    expect(openDicomFilesMock).toHaveBeenCalledTimes(2);
  });
});
