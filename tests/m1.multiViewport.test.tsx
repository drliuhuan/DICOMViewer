/**
 * M1 验收缺陷回归：多视口可加载显示任意序列（1×2 / 2×2）。
 *
 * 根因 1：createBoundToolGroup 以共享引擎 id 作为 ToolGroup id，
 *   ToolGroupManager 对重名 id 返回 undefined → 第二个及以后的视口
 *   初始化抛错、pipelineReady 永不就绪 → 除 vp-0 外全部空白。
 *   （唯一性断言见 m1.toolgroup.test.ts）
 *
 * 根因 2（assignments→imageIds 映射）：未指派视口每轮渲染生成新 `[]`
 *   items → imageIds 引用变化 → 堆栈 effect 重跑；publishUi 又无条件
 *   产出新对象并同步触发父组件 setState → App 再渲染 → 死循环，
 *   空视口常驻满负荷自旋、布局切换后界面冻结。
 *   修复：App 用模块级 EMPTY_ITEMS 保持引用稳定；publishUi 内容不变时
 *   返回原 state；父组件通知移到提交后的专用 effect。
 *
 * 本文件 mock 渲染管线，锁定：
 * - 切 2×2 后四个视口逐一 enableElement（viewportId 唯一）且各自拿到
 *   独立 ToolGroup；
 * - 激活任一视口后点击/放置序列，该序列 imageIds 恰好 setStack 到该视口；
 * - 同一序列可同时显示在多个视口；
 * - 存在空视口时渲染收敛（setStack 不随无关更新反复执行）。
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
  DEFAULT_PRIMARY_TOOL: 'Pan',
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

function makeOpenedFile(seriesUid: string, baseImageId: string) {
  return {
    fileName: `${seriesUid}.dcm`,
    fileSizeBytes: 128,
    baseImageId,
    summary: {
      patientName: '',
      patientId: undefined,
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: undefined,
      studyDate: undefined,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: seriesUid,
      seriesNumber: 1,
      seriesDescription: undefined,
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
      sopInstanceUid: undefined,
      transferSyntaxUid: undefined,
    },
  };
}

function makeViewportStub() {
  // setStack/removeAllActors 维护 actor 状态，与 cornerstone 实际语义一致
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

type ViewportStub = ReturnType<typeof makeViewportStub>;

/** 引擎替身：按 viewportId 维护各自独立的 viewport 实例 */
function makeEngineStub() {
  const viewports = new Map<string, ViewportStub>();
  return {
    viewports,
    engine: {
      enableElement: vi.fn((options: { viewportId: string }) => {
        viewports.set(options.viewportId, makeViewportStub());
      }),
      disableElement: vi.fn(),
      getViewport: vi.fn((_id: string) => viewports.get(_id) ?? null),
      resize: vi.fn(),
    },
  };
}

async function settle(rounds = 8): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

/** 向 window 派发携带自定义 dataTransfer 的原生拖拽事件 */
function fireWindowDragEvent(
  type: 'dragenter' | 'dragleave' | 'drop',
  dataTransfer: Record<string, unknown>,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  window.dispatchEvent(event);
}

describe('多视口加载任意序列（App 集成）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    openDicomFilesMock.mockResolvedValue({
      opened: [
        makeOpenedFile('1.2.series-b', 'dcm-file://b'),
        makeOpenedFile('1.2.series-a', 'dcm-file://a'),
      ],
      failures: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderAppWithTwoSeries() {
    const { default: App } = await import('../src/app/App');
    const engineStub = makeEngineStub();
    getRenderingEngineMock.mockReturnValue(engineStub.engine);
    // 挂载（act 结束后 window 级监听已就绪）
    const view = await act(async () => render(<App />));
    // window drop → handleFiles → 两个序列入面板
    await act(async () => {
      fireWindowDragEvent('drop', { types: ['Files'], files: [new File([], 'a')] });
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }
    });
    return { ...engineStub, view };
  }

  function switchLayout(container: HTMLElement, label: string): void {
    fireEvent.click(
      Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === label,
      )!,
    );
  }

  function cellsOf(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.viewport-cell'));
  }

  it('切 2×2 后四个视口逐一 enableElement 且各持独立 ToolGroup', async () => {
    const { engine, view } = await renderAppWithTwoSeries();

    switchLayout(view.container, '2×2');
    await settle();

    expect(engine.enableElement).toHaveBeenCalledTimes(4);
    const enabledIds = engine.enableElement.mock.calls.map(
      (call) => (call[0] as { viewportId: string }).viewportId,
    );
    expect(enabledIds).toEqual(['vp-0', 'vp-1', 'vp-2', 'vp-3']);
    expect(new Set(enabledIds).size).toBe(4);

    // 每个视口独立创建 ToolGroup（viewportId 一一对应）
    const toolGroupViewportIds = createBoundToolGroupMock.mock.calls.map(
      (call) => call[1],
    );
    expect(new Set(toolGroupViewportIds)).toEqual(
      new Set(['vp-0', 'vp-1', 'vp-2', 'vp-3']),
    );
  });

  it('激活任意视口后点击序列：imageIds 恰好加载到该视口', async () => {
    const { viewports, view } = await renderAppWithTwoSeries();

    switchLayout(view.container, '2×2');
    await settle();

    // 点击第三个视格激活 vp-2，再点第二张卡片（series-b）
    fireEvent.mouseDown(cellsOf(view.container)[2]!);
    await act(async () => {
      fireEvent.click(view.container.querySelectorAll('.series-item')[1]!);
      await Promise.resolve();
    });

    expect(viewports.get('vp-2')!.setStack).toHaveBeenCalledWith(['dcm-file://b']);
    // 其他视口未被误加载 series-b
    expect(viewports.get('vp-0')!.setStack).not.toHaveBeenCalledWith(['dcm-file://b']);
    expect(viewports.get('vp-3')!.setStack).not.toHaveBeenCalledWith(['dcm-file://b']);
  });

  it('同一序列可同时显示在多个视口', async () => {
    const { viewports, view } = await renderAppWithTwoSeries();

    switchLayout(view.container, '1×2');
    await settle();

    // 激活第二个视格，点击第一张卡片（series-a，与 vp-0 相同序列）
    fireEvent.mouseDown(cellsOf(view.container)[1]!);
    await act(async () => {
      fireEvent.click(view.container.querySelectorAll('.series-item')[0]!);
      await Promise.resolve();
    });

    expect(viewports.get('vp-1')!.setStack).toHaveBeenCalledWith(['dcm-file://a']);
    expect(viewports.get('vp-0')!.setStack).toHaveBeenCalledWith(['dcm-file://a']);
  });

  it('存在空视口时渲染收敛：无关更新不会反复触发 setStack', async () => {
    const { viewports, view } = await renderAppWithTwoSeries();

    switchLayout(view.container, '2×2'); // 仅 vp-0 有序列，其余三个为空
    await settle();

    const vp0 = viewports.get('vp-0')!;
    expect(vp0.setStack).toHaveBeenCalledTimes(1);

    // 制造一批与 assignments 无关的更新（激活切换 / 全局拖拽态翻转）
    for (const cell of cellsOf(view.container)) {
      fireEvent.mouseDown(cell);
    }
    fireWindowDragEvent('dragenter', { types: ['Files'] });
    fireWindowDragEvent('dragleave', { types: ['Files'] });
    await settle();

    expect(vp0.setStack).toHaveBeenCalledTimes(1);
    expect(viewports.get('vp-1')!.setStack).not.toHaveBeenCalled();
  });
});
