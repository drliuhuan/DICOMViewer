/**
 * M11 任务 2：3D 入口静默失败修复——调用链测试。
 *
 * 根因证据（详见修复注释）：
 * 1) App 首次渲染一次性探测 WebGL2 并永久缓存 → 启动早期误判 false 后
 *    「3D」按钮被原生 disabled，点击既无事件也无提示（用户症状）；
 * 2) 禁用态无任何反馈通道；
 * 3) 入口回调内异常无兜底反馈。
 *
 * 覆盖：WebGL2 重探恢复路径、禁用态点击反馈、数据门槛禁用反馈、
 * 入口异常 toast 兜底。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  webgl2Available: true,
  throwOnDecideEntry: false,
}));

const { getRenderingEngineMock } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
}));

const enabledInputs: Array<{ viewportId: string; type?: string }> = [];

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack', ORTHOGRAPHIC: 'orthographic', VOLUME_3D: 'volume3d' },
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
    TrackballRotateTool: defineTool('TrackballRotate'),
    OrientationMarkerTool: defineTool('OrientationMarker'),
    ToolGroupManager: {
      createToolGroup: vi.fn(() => ({
        id: 'g',
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
  withFrameNumber: vi.fn((base: string, frame: number) =>
    frame > 1 ? `${base}?frame=${frame}` : base,
  ),
  getBufferForImageId: vi.fn(() => new ArrayBuffer(16)),
  baseImageIdOf: vi.fn((imageId: string) => imageId.split('?')[0]!),
  releaseDcmFileKey: vi.fn(() => true),
  clearDcmFileRegistry: vi.fn(),
  ensureDcmFileMetadata: vi.fn(async () => undefined),
}));

// 能力探测打桩：按 state.webgl2Available 动态返回
vi.mock('../src/features/volume3d/gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/volume3d/gate')>();
  return {
    ...actual,
    hasWebGL2: () => state.webgl2Available,
  };
});

// 序列选择判定打桩：可注入抛错，覆盖入口异常 toast 兜底
vi.mock('../src/features/series/entryDecision', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/features/series/entryDecision')
  >();
  return {
    ...actual,
    decideSeriesEntry: (args: Parameters<typeof actual.decideSeriesEntry>[0]) => {
      if (state.throwOnDecideEntry) {
        throw new Error('入口决策爆炸');
      }
      return actual.decideSeriesEntry(args);
    },
  };
});

vi.mock('../src/features/volume3d/apply', () => ({
  applyPresetToViewport: vi.fn(async () => true),
  applySampleDistanceMultiplier: vi.fn(),
  applyWwWlToViewport: vi.fn(),
  applyClippingToViewport: vi.fn(async () => true),
  resetVolume3dCamera: vi.fn(),
  screenshotVolume3d: vi.fn(() => 'data:image/png;base64,AAA'),
  downloadDataUrl: vi.fn(),
  buildColorTransferFunction: vi.fn(),
  buildPiecewiseFunction: vi.fn(),
  buildClippingPlanes: vi.fn(() => []),
  computeAxialTopDownCamera: vi.fn(() => null),
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
      modality: 'CT',
      studyInstanceUid: '1.2.study',
      seriesInstanceUid: seriesUid,
      seriesNumber: 1,
      instanceNumber,
      pixelSpacing: [0.5, 0.5],
      imagePositionPatient: [0, 0, (instanceNumber - 1) * 2],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      rows: 16,
      columns: 16,
      numberOfFrames: 1,
      sopInstanceUid: `1.2.sop${instanceNumber}`,
    },
  };
}

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

function makeViewportStub() {
  return {
    setStack: vi.fn(async () => undefined),
    render: vi.fn(),
    setProperties: vi.fn(),
    getProperties: vi.fn(() => ({ voiRange: { lower: -400, upper: 400 } })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    setImageIdIndex: vi.fn(),
    getActors: vi.fn(() => []),
    removeAllActors: vi.fn(),
    setBlendMode: vi.fn(),
    setSlabThickness: vi.fn(),
    getImageData: vi.fn(() => undefined),
    setSampleDistanceMultiplier: vi.fn(),
    getCanvas: vi.fn(() => ({ toDataURL: vi.fn(() => 'data:image/png;base64,AAA') })),
  };
}

async function flush(rounds = 12): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
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

describe('App × 3D/MPR 入口静默失败修复（M11 任务 2）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    enabledInputs.length = 0;
    state.webgl2Available = true;
    state.throwOnDecideEntry = false;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function renderEngine() {
    const viewports: Record<string, ReturnType<typeof makeViewportStub>> = {};
    const engine = {
      enableElement: vi.fn((input: { viewportId: string }) => {
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
    return engine;
  }

  async function renderLoaded(count: number) {
    openDicomFilesMock.mockResolvedValue({
      opened: Array.from({ length: count }, (_, i) => makeOpenedFile(i + 1)),
      failures: [],
      cancelled: false,
    });
    renderEngine();
    const { default: App } = await import('../src/app/App');
    const view = await act(async () => render(<App />));
    await dropFiles(count);
    await flush();
    return view;
  }

  it('WebGL2 探测失败时 3D 入口被禁用且点击有明确提示（非无声）', async () => {
    state.webgl2Available = false;
    const view = await renderLoaded(3);
    const button = findButton(view.container, '3D');
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('WebGL2');

    // 点击禁用按钮的外层包装 → toast 给出原因（此前版本完全无声）
    fireEvent.click(button.closest('.entry-gate-wrap')!);
    {
      const toast = await screen.findByRole('status');
      expect(toast.textContent).toContain('WebGL2');
    };
  }, 20000);

  it('窗口聚焦重探 WebGL2 成功后自动解除误禁用并可进入 3D', async () => {
    state.webgl2Available = false;
    const view = await renderLoaded(3);
    expect(findButton(view.container, '3D').disabled).toBe(true);

    // GPU 恢复 + 窗口聚焦 → 自动重探为可用
    state.webgl2Available = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    const button = findButton(view.container, '3D');
    expect(button.disabled).toBe(false);

    // 正常进入体绘制布局
    fireEvent.click(button);
    await screen.findByText('3D 体绘制');
    await flush();
    expect(
      enabledInputs.some((input) => input.viewportId === 'vol3d-main'),
    ).toBe(true);
  }, 20000);

  it('数据门槛不满足（层数不足）时点击入口包装同样给出原因提示', async () => {
    const view = await renderLoaded(1);
    const mprButton = findButton(view.container, 'MPR');
    expect(mprButton.disabled).toBe(true);
    fireEvent.click(mprButton.closest('.entry-gate-wrap')!);
    {
      const toast = await screen.findByRole('status');
      expect(toast.textContent).toContain('至少 2 层');
    };

    const vol3dButton = findButton(view.container, '3D');
    fireEvent.click(vol3dButton.closest('.entry-gate-wrap')!);
    {
      const toast = await screen.findByRole('status');
      expect(toast.textContent).toContain('至少 2 层');
    };
  }, 20000);

  it('入口决策异常时以 toast 明确报错而非静默', async () => {
    state.throwOnDecideEntry = true;
    const view = await renderLoaded(3);
    const vol3dButton = findButton(view.container, '3D');
    fireEvent.click(vol3dButton);
    {
      const toast = await screen.findByRole('status');
      expect(toast.textContent).toContain('打开3D失败');
    };

    const mprButton = findButton(view.container, 'MPR');
    fireEvent.click(mprButton);
    {
      const toast = await screen.findByRole('status');
      expect(toast.textContent).toContain('打开MPR失败');
    };
  }, 20000);
});
