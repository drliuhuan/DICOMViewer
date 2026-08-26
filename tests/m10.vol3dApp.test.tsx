/**
 * M10-C App 集成（FR-7.1/7.12）：工具栏「3D」入口按数据门槛禁用+原因提示；
 * 可进入体绘制（VOLUME_3D 视口启用）并可退出回 2D（释放视口）。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + 打开管线 + vtk 装配）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { getRenderingEngineMock, enabledInputs } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
  enabledInputs: [] as Array<{
    viewportId: string;
    type: string;
    defaultOptions?: { orientation?: string };
  }>,
}));

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
    TrackballRotateTool: defineTool('TrackballRotate'),
    OrientationMarkerTool: defineTool('OrientationMarker'),
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
  createDcmFileImageId: vi.fn((_buffer: ArrayBuffer) => 'dcm-file://mocked'),
  withFrameNumber: vi.fn((baseImageId: string, frameNumber: number) =>
    frameNumber > 1 ? `${baseImageId}?frame=${frameNumber}` : baseImageId,
  ),
  getBufferForImageId: vi.fn(() => new ArrayBuffer(16)),
  baseImageIdOf: vi.fn((imageId: string) => (imageId.includes('?') ? imageId.split('?')[0] : imageId)),
  releaseDcmFileKey: vi.fn(() => true),
  clearDcmFileRegistry: vi.fn(),
  ensureDcmFileMetadata: vi.fn(async () => undefined),
}));

// 3D 能力门槛：测试环境注入 WebGL2 可用；vtk 装配打桩
vi.mock('../src/features/volume3d/gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/volume3d/gate')>();
  return { ...actual, hasWebGL2: () => true };
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
      patientSexName: undefined,
    },
  };
}

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

function makeViewportStub() {
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
    setImageIdIndex: vi.fn(),
    getActors: vi.fn(() => actors),
    removeAllActors: vi.fn(() => {
      actors = [];
    }),
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

function renderEngine() {
  const viewports: Record<string, ReturnType<typeof makeViewportStub>> = {};
  const engine = {
    enableElement: vi.fn((input: {
      viewportId: string;
      type: string;
      defaultOptions?: { orientation?: string };
    }) => {
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

describe('App × 3D 体绘制（FR-7.1/7.12）', () => {
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

  it('层数 < 2 时 3D 入口禁用并提示原因（FR-7.1 数据门槛）', async () => {
    const { view } = await renderLoaded(1);
    const button = findButton(view.container, '3D');
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('至少 2 层');
  });

  it('合法序列时 3D 入口可用：点击进入体绘制并退出（FR-7.1/7.12）', async () => {
    const { view, engine } = await renderLoaded(3);
    const button = findButton(view.container, '3D');
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await screen.findByText('3D 体绘制');
    await flush();

    // VOLUME_3D 视口启用（vol3d-main），与 2D/MPR 共用渲染引擎
    const vol3dInputs = enabledInputs.filter((input) => input.viewportId === 'vol3d-main');
    expect(vol3dInputs.length).toBe(1);
    expect(vol3dInputs[0]?.type).toBe('volume3d');
    expect(button.className).toContain('tool-button--active');

    // 退出：返回 2D 网格，3D 视口被禁用
    fireEvent.click(screen.getByText('退出 3D'));
    await flush();
    expect(screen.queryByText('3D 体绘制')).toBeNull();
    expect(engine.disableElement).toHaveBeenCalledWith('vol3d-main');
  });

  it('3D 与 MPR 互斥：进入 3D 时退出 MPR（共用引擎不冲突）', async () => {
    const { view, engine } = await renderLoaded(3);
    const mprButton = findButton(view.container, 'MPR');
    const vol3dButton = findButton(view.container, '3D');

    fireEvent.click(mprButton);
    await screen.findByText('MPR 三平面');
    await flush();

    fireEvent.click(vol3dButton);
    await screen.findByText('3D 体绘制');
    await flush();
    expect(screen.queryByText('MPR 三平面')).toBeNull();
    expect(engine.disableElement).toHaveBeenCalledWith('mpr-axial');
  });
});