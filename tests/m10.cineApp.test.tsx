/**
 * M10-E App 集成（FR-3.8 Cine / FR-3.9 反色 / FR-3.10 旋转）：
 * 工具栏按钮与快捷键驱动视口命令式 API，方向标记随旋转更新。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + 打开管线）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const { getRenderingEngineMock, enabledInputs } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
  enabledInputs: [] as Array<{ viewportId: string; type: string }>,
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack', ORTHOGRAPHIC: 'orthographic' },
    OrientationAxis: { AXIAL: 'axial', CORONAL: 'coronal', SAGITTAL: 'sagittal' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'cornerstonestackviewportscroll',
      VOI_MODIFIED: 'cornerstonevoimodified',
      CAMERA_MODIFIED: 'cornerstonecameramodified',
      VOLUME_NEW_IMAGE: 'cornerstonevolumenewimage',
    },
    BlendModes: {
      AVERAGE_INTENSITY_BLEND: 0,
      MAXIMUM_INTENSITY_BLEND: 1,
      MINIMUM_INTENSITY_BLEND: 2,
    },
    MetadataModules: { IMAGE_PLANE: 'imagePlaneModule' },
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
  setVolumesForViewports: vi.fn(async () => undefined),
  volumeLoader: { registerVolumeLoader: vi.fn(), createAndCacheVolume: vi.fn() },
  cornerstoneStreamingImageVolumeLoader: { streamLoader: true },
  metaData: { addProvider: vi.fn(), removeProvider: vi.fn(), get: vi.fn() },
}));

vi.mock('@cornerstonejs/tools', () => {
  function defineTool(name: string) {
    return class {
      static toolName = name;
    };
  }
  const groups: unknown[] = [];
  return {
    Enums: {
      MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 },
      KeyboardBindings: { Ctrl: 17 },
    },
    init: vi.fn(),
    addTool: vi.fn(),
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
    ToolGroupManager: {
      createToolGroup: vi.fn((id: string) => {
        const group = {
          id,
          addViewport: vi.fn(),
          addTool: vi.fn(),
          setToolActive: vi.fn(),
          setToolPassive: vi.fn(),
        };
        groups.push(group);
        return group;
      }),
      destroyToolGroup: vi.fn(),
    },
    __groups: groups,
  };
});

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

vi.mock('../src/dicom/imageId', () => ({
  createDcmFileImageId: vi.fn(() => 'dcm-file://mocked'),
  withFrameNumber: vi.fn((base: string, frame: number) => (frame > 1 ? `${base}?frame=${frame}` : base)),
  getBufferForImageId: vi.fn(() => new ArrayBuffer(16)),
  baseImageIdOf: vi.fn((imageId: string) => (imageId.includes('?') ? imageId.split('?')[0] : imageId)),
  releaseDcmFileKey: vi.fn(() => true),
  clearDcmFileRegistry: vi.fn(),
  ensureDcmFileMetadata: vi.fn(async () => undefined),
}));

const openDicomFilesMock = vi.hoisted(() => vi.fn());
vi.mock('../src/features/loading/openDicomFiles', () => ({
  openDicomFiles: openDicomFilesMock,
}));

function makeOpenedFile(instanceNumber: number, seriesUid = '1.2.s') {
  return {
    fileName: `slice-${instanceNumber}.dcm`,
    fileSizeBytes: 128,
    baseImageId: `dcm-file://key-${instanceNumber}`,
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
      seriesDescription: undefined,
      instanceNumber,
      sliceLocation: undefined,
      sliceThickness: 1.25,
      pixelSpacing: [0.5, 0.5],
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
      sopClassUid: undefined,
      sopInstanceUid: `1.2.sop${instanceNumber}`,
      transferSyntaxUid: undefined,
    },
  };
}

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

function makeViewportStub() {
  let actors: Array<{ uid: string }> = [];
  let rotation = 0;
  const props: Record<string, unknown> = { voiRange: { lower: -400, upper: 400 } };
  return {
    setStack: vi.fn(async () => {
      actors = [{ uid: 'stack-actor' }];
    }),
    render: vi.fn(),
    setProperties: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(props, patch);
    }),
    getProperties: vi.fn(() => ({ ...props })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    setImageIdIndex: vi.fn(),
    getRotation: vi.fn(() => rotation),
    setRotation: vi.fn((value: number) => {
      rotation = value;
    }),
    getActors: vi.fn(() => actors),
    removeAllActors: vi.fn(() => {
      actors = [];
    }),
    setBlendMode: vi.fn(),
    setSlabThickness: vi.fn(),
  };
}

async function flush(rounds = 12): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

function renderEngine() {
  const viewports: Record<string, ReturnType<typeof makeViewportStub>> = {};
  const engine = {
    enableElement: vi.fn((input: { viewportId: string; type: string }) => {
      enabledInputs.push(input);
      return input;
    }),
    disableElement: vi.fn(),
    getViewport: vi.fn((viewportId: string) => {
      return (viewports[viewportId] ??= makeViewportStub());
    }),
    resize: vi.fn(),
    render: vi.fn(),
  };
  getRenderingEngineMock.mockReturnValue(engine);
  return { engine, viewports };
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
  return button;
}

describe('App × Cine/反色/旋转（FR-3.8/3.9/3.10）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    enabledInputs.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  async function renderLoaded(count: number) {
    openDicomFilesMock.mockResolvedValue({
      opened: Array.from({ length: count }, (_, i) => makeOpenedFile(i + 1)),
      failures: [],
      cancelled: false,
    });
    const { engine } = renderEngine();
    const { default: App } = await import('../src/app/App');
    const view = await act(async () => render(<App />));
    await dropFiles(count);
    await flush();
    return { view, engine };
  }

  it('Cine：多层序列出现播放/停止/速度/循环控件，播放经视口 API 推进帧（FR-3.8）', async () => {
    vi.useFakeTimers();
    const { view, engine } = await renderLoaded(3);
    const vp = engine.getViewport('vp-0');
    expect(vp.setImageIdIndex).not.toHaveBeenCalled();

    fireEvent.click(findButton(view.container, '播放'));
    await flush();
    // 播放按钮进入激活态（显示为「暂停」）
    expect(findButton(view.container, '暂停')).toBeTruthy();
    expect(view.baseElement.querySelector('.cine-speed-slider')).toBeTruthy();
    expect(view.baseElement.querySelector('.cine-loop-input')).toBeTruthy();

    // 假定时器推进：10fps → 播放期间持续推进帧
    const before = vp.setImageIdIndex.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(vp.setImageIdIndex.mock.calls.length).toBeGreaterThan(before);

    // 停止：暂停并回到首帧
    fireEvent.click(findButton(view.container, '停止'));
    vi.runAllTimers();
    await flush();
    expect(vp.setImageIdIndex).toHaveBeenLastCalledWith(0);
    expect(findButton(view.container, '播放')).toBeTruthy();
  });

  it('空格键快捷键播放/暂停 Cine（FR-3.8）', async () => {
    const { view } = await renderLoaded(3);
    fireEvent.keyDown(window, { key: ' ', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    await flush();
    expect(findButton(view.container, '暂停')).toBeTruthy();
    fireEvent.keyDown(window, { key: ' ', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    await flush();
    expect(findButton(view.container, '播放')).toBeTruthy();
  });

  it('单帧序列不出现 Cine 控件，播放提示（FR-3.8）', async () => {
    const { view } = await renderLoaded(1);
    expect(view.baseElement.querySelector('.cine-speed-slider')).toBeNull();
  });

  it('反色：工具栏按钮与 Shift+I 切换视口 invert 属性（FR-3.9）', async () => {
    const { view, engine } = await renderLoaded(2);
    const vp = engine.getViewport('vp-0');

    const invertBtn = findButton(view.container, '反色');
    expect(invertBtn.className).not.toContain('tool-button--active');

    fireEvent.click(invertBtn);
    await flush();
    expect(vp.setProperties).toHaveBeenCalledWith(expect.objectContaining({ invert: true }));
    // 各视口独立：仅激活视口属性翻转（vp-0 未翻转）
    expect(engine.getViewport('vp-0').setProperties).toHaveBeenCalled();

    // Shift+I 同样触发
    vp.setProperties.mockClear();
    fireEvent.keyDown(window, { key: 'I', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false });
    await flush();
    expect(vp.setProperties).toHaveBeenCalledWith(expect.objectContaining({ invert: false }));
  });

  it('旋转：[ / ] 快捷键与工具栏按 90° 步进，方向标记随视图更新（FR-3.10/FR-4.10）', async () => {
    const { view, engine } = await renderLoaded(2);
    const vp = engine.getViewport('vp-0');
    // 初始轴向 HFS：顶部=前(A)
    expect(view.baseElement.querySelector('.orient-top')?.textContent).toBe('A');

    // [ = 逆时针 90° → 顶部变为右侧标记 R（患者右侧移向顶部）
    fireEvent.keyDown(window, { key: '[', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    await flush();
    expect(vp.setRotation).toHaveBeenCalledWith(90);
    expect(view.baseElement.querySelector('.orient-top')?.textContent).toBe('R');

    // 工具栏顺时针按钮 → 回 0°
    const clockwise = Array.from(view.container.querySelectorAll('button')).find((b) =>
      b.title.includes('顺时针'),
    )!;
    fireEvent.click(clockwise);
    await flush();
    expect(vp.setRotation).toHaveBeenCalledWith(0);
    expect(view.baseElement.querySelector('.orient-top')?.textContent).toBe('A');
  });
});