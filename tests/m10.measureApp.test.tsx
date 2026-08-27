/**
 * M10-D App 集成（FR-5.1~5.13）：测量工具栏转正 / 校准入口 / 标注管理面板 /
 * 序列关闭时标注清理与校准登记清除（FR-5.10）。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + 打开管线），tools 提供 fake
 * 标注状态用于验证清理链路。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {
  getRenderingEngineMock,
  annotationList,
  removedUids,
  selectedUids,
} = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
  annotationList: [] as unknown[],
  removedUids: [] as string[],
  selectedUids: [] as string[],
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack', ORTHOGRAPHIC: 'orthographic' },
    OrientationAxis: { AXIAL: 'axial', CORONAL: 'coronal', SAGITTAL: 'sagittal' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'stackscroll',
      VOI_MODIFIED: 'voimodified',
      CAMERA_MODIFIED: 'cameramodified',
    },
  },
  RenderingEngine: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  cache: { removeImageLoadObject: vi.fn(), purgeCache: vi.fn(), removeVolumeLoadObject: vi.fn() },
  utilities: { scroll: vi.fn(), transformWorldToIndex: vi.fn() },
  getRenderingEngine: getRenderingEngineMock,
  volumeLoader: { registerVolumeLoader: vi.fn(), createAndCacheVolume: vi.fn() },
  cornerstoneStreamingImageVolumeLoader: { streamLoader: true },
  metaData: { addProvider: vi.fn(), removeProvider: vi.fn(), get: vi.fn() },
  eventTarget: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
}));

vi.mock('@cornerstonejs/tools', () => {
  function defineTool(name: string) {
    return class {
      static toolName = name;
    };
  }
  return {
    Enums: {
      MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 },
      KeyboardBindings: { Ctrl: 17 },
    },
    init: vi.fn(),
    addTool: vi.fn(),
    // M11-F3：App 依赖链新增 mprToolGroup 模块级 CrosshairsTool 常量
    CrosshairsTool: defineTool('Crosshairs'),
    WindowLevelTool: defineTool('WindowLevel'),
    ZoomTool: defineTool('Zoom'),
    PanTool: defineTool('Pan'),
    StackScrollTool: defineTool('StackScroll'),
    LengthTool: defineTool('Length'),
    AngleTool: defineTool('Angle'),
    RectangleROITool: defineTool('RectangleROI'),
    EllipticalROITool: defineTool('EllipticalROI'),
    ProbeTool: defineTool('Probe'),
    state: {
      getAllAnnotations: () => annotationList,
      removeAnnotation: (uid: string) => {
        removedUids.push(uid);
        const index = annotationList.findIndex(
          (item) => (item as { annotationUID?: string }).annotationUID === uid,
        );
        if (index >= 0) {
          annotationList.splice(index, 1);
        }
      },
      addAnnotation: vi.fn(),
    },
    annotation: {
      selection: {
        getAnnotationsSelected: () => selectedUids,
        setAnnotationSelected: vi.fn(),
      },
      visibility: {
        setAnnotationVisibility: vi.fn(),
        showAllAnnotations: vi.fn(),
      },
    },
    ToolGroupManager: {
      createToolGroup: vi.fn((id: string) => ({
        id,
        addViewport: vi.fn(),
        addTool: vi.fn(),
        setToolActive: vi.fn(),
        setToolPassive: vi.fn(),
      })),
      destroyToolGroup: vi.fn(),
    },
  };
});

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

vi.mock('../src/dicom/imageId', () => ({
  createDcmFileImageId: vi.fn((_buffer: ArrayBuffer) => 'dcm-file://mocked'),
  getBufferForImageId: vi.fn(() => new ArrayBuffer(16)),
  baseImageIdOf: vi.fn((imageId: string) =>
    imageId.includes('?') ? imageId.split('?')[0] : imageId,
  ),
  releaseDcmFileKey: vi.fn(() => true),
  clearDcmFileRegistry: vi.fn(),
  ensureDcmFileMetadata: vi.fn(async () => undefined),
}));

const openDicomFilesMock = vi.hoisted(() => vi.fn());
vi.mock('../src/features/loading/openDicomFiles', () => ({
  openDicomFiles: openDicomFilesMock,
}));

function makeOpenedFile(
  instanceNumber: number,
  seriesUid: string,
  opts: { pixelSpacing?: [number, number] | undefined } = {},
) {
  return {
    fileName: `${seriesUid}-${instanceNumber}.dcm`,
    fileSizeBytes: 128,
    baseImageId: `dcm-file://${seriesUid}-${instanceNumber}`,
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
      seriesDescription: `series-${seriesUid}`,
      instanceNumber,
      sliceLocation: undefined,
      sliceThickness: 1.25,
      pixelSpacing: opts.pixelSpacing,
      imagePositionPatient: [0, 0, (instanceNumber - 1) * 2],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      frameOfReferenceUid: '1.2.f',
      perFrameImagePositions: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 16,
      columns: 16,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      sopInstanceUid: `1.2.sop${seriesUid}-${instanceNumber}`,
      transferSyntaxUid: undefined,
    },
  };
}

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

async function flush(rounds = 16): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

function renderEngine() {
  const viewports: Record<string, Record<string, unknown>> = {};
  const engine = {
    enableElement: vi.fn((input: { viewportId: string }) => input),
    disableElement: vi.fn(),
    getViewport: vi.fn((viewportId: string) => {
      return (viewports[viewportId] ??= {
        setStack: vi.fn(async () => undefined),
        render: vi.fn(),
        setProperties: vi.fn(),
        getProperties: vi.fn(() => ({ voiRange: { lower: -400, upper: 400 } })),
        getCurrentImageIdIndex: vi.fn(() => 0),
        getCamera: vi.fn(() => ({ parallelScale: 100 })),
        getZoom: vi.fn(() => 1),
      });
    }),
    resize: vi.fn(),
    render: vi.fn(),
  };
  getRenderingEngineMock.mockReturnValue(engine);
  return { engine };
}

async function dropFiles(count: number): Promise<void> {
  await act(async () => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [new File([], `f${count}`)] },
    });
    window.dispatchEvent(event);
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) {
    throw new Error(`button not found: ${text}`);
  }
  return button as HTMLButtonElement;
}

describe('App × 测量与标注（M10-D FR-5）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    annotationList.length = 0;
    removedUids.length = 0;
    selectedUids.length = 0;
    getRenderingEngineMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('测量工具栏按钮存在且点击激活（FR-5.1~5.4 解占位）', async () => {
    openDicomFilesMock.mockResolvedValue({
      opened: [1, 2, 3].map((i) => makeOpenedFile(i, '1.2.s-with', { pixelSpacing: [0.5, 0.5] })),
      failures: [],
      cancelled: false,
    });
    renderEngine();
    const { default: App } = await import('../src/app/App');
    const view = await act(async () => render(<App />));
    await dropFiles(3);
    await flush();

    for (const label of ['长度', '角度', '矩形', '椭圆']) {
      const button = findButton(view.container, label);
      expect(button.disabled).toBe(false);
    }

    const length = findButton(view.container, '长度');
    fireEvent.click(length);
    expect(length.className).toContain('tool-button--active');

    // 像素间距存在：不出现「校准」入口（FR-5.8）
    expect(Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent === '校准')).toBeUndefined();
  });

  it('像素间距缺失时出现「校准」入口（FR-5.8）', async () => {
    openDicomFilesMock.mockResolvedValue({
      opened: [1, 2, 3, 4].map((i) => makeOpenedFile(i, '1.2.s-no')), // 无 pixelSpacing
      failures: [],
      cancelled: false,
    });
    renderEngine();
    const { default: App } = await import('../src/app/App');
    const view = await act(async () => render(<App />));
    await dropFiles(4);
    await flush();

    const calibrate = Array.from(view.container.querySelectorAll('button')).find(
      (b) => b.textContent === '校准',
    ) as HTMLButtonElement | undefined;
    expect(calibrate).toBeDefined();
    expect(calibrate!.title).toContain('无法计算物理尺寸');
  });

  it('标注面板：列出 fake 状态标注行并可删除（FR-5.9）', async () => {
    annotationList.push({
      annotationUID: 'ann-1',
      metadata: { toolName: 'Length', referencedImageId: 'dcm-file://1.2.s-with-1' },
      data: {
        handles: { points: [[0, 0, 0], [10, 0, 0]] },
        cachedStats: { target: { length: 20, unit: 'px' } },
      },
      isVisible: true,
    });
    openDicomFilesMock.mockResolvedValue({
      opened: [1, 2, 3].map((i) => makeOpenedFile(i, '1.2.s-with', { pixelSpacing: [0.5, 0.5] })),
      failures: [],
      cancelled: false,
    });
    renderEngine();
    const { default: App } = await import('../src/app/App');
    const view = await act(async () => render(<App />));
    await dropFiles(3);
    await flush();
    // 先打开标注管理面板，再等待运行时加载完成后版本刷新、行数据呈现（FR-5.9）
    const toggle = findButton(view.container, '标注');
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText('长度 20 px', { exact: false })).not.toBeNull();
    });
    expect(screen.getByText('标注管理')).not.toBeNull();

    const rowEl = screen.getByText('长度 20 px', { exact: false }).closest('.annotations-row')!;
    fireEvent.click(Array.from(rowEl.querySelectorAll('button')).find((b) => b.textContent === '删除')!);
    await waitFor(() => {
      expect(removedUids).toContain('ann-1');
    });
  });

  it('关闭序列时清理该序列标注（FR-5.10）', async () => {
    annotationList.push(
      {
        annotationUID: 'ann-s1',
        metadata: { toolName: 'Length', referencedImageId: 'dcm-file://1.2.s-a-1' },
        data: { handles: { points: [[0, 0, 0], [10, 0, 0]] }, cachedStats: { t: { length: 1, unit: 'px' } } },
        isVisible: true,
      },
      {
        annotationUID: 'ann-s2',
        metadata: { toolName: 'Length', referencedImageId: 'dcm-file://1.2.s-b-1' },
        data: { handles: { points: [[0, 0, 0], [10, 0, 0]] }, cachedStats: { t: { length: 1, unit: 'px' } } },
        isVisible: true,
      },
    );
    openDicomFilesMock.mockResolvedValue({
      opened: [
        ...[1, 2].map((i) => makeOpenedFile(i, '1.2.s-a', { pixelSpacing: [0.5, 0.5] })),
        ...[1, 2].map((i) => makeOpenedFile(i, '1.2.s-b', { pixelSpacing: [0.5, 0.5] })),
      ],
      failures: [],
      cancelled: false,
    });
    renderEngine();
    const { default: App } = await import('../src/app/App');
    await act(async () => render(<App />));
    await dropFiles(4);
    await dropFiles(5);
    await flush();

    // 关闭序列 s-a 的按钮（SeriesPanel 内关闭控件为 span[role=button]，class series-item-close）
    const closeButton = Array.from(document.querySelectorAll('.series-item-close')).find(
      (b) => b.getAttribute('aria-label')?.startsWith('关闭序列') && b.getAttribute('aria-label')!.includes('s-a'),
    );
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton!);
    await flush();
    expect(removedUids).toContain('ann-s1');
    expect(removedUids).not.toContain('ann-s2');
  });
});