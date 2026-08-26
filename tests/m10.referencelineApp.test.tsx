/**
 * M10-E App 集成（FR-6.10 参考线随动）：
 * 进入 MPR → 退出后，2D Stack 视口绘制 MPR 三平面与当前切片的交线叠加。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + 打开管线 + volume 装配）。
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

/** 2D Stack 视口桩：含参考线所需的 getImageData / worldToCanvas */
function makeStackViewportStub() {
  let actors: Array<{ uid: string }> = [];
  const props: Record<string, unknown> = { voiRange: { lower: -400, upper: 400 } };
  return {
    setStack: vi.fn(async () => {
      actors = [{ uid: 'stack-actor' }];
    }),
    render: vi.fn(),
    setProperties: vi.fn((patch: Record<string, unknown>) => Object.assign(props, patch)),
    getProperties: vi.fn(() => ({ ...props })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    setImageIdIndex: vi.fn(),
    getRotation: vi.fn(() => 0),
    setRotation: vi.fn(),
    getImageData: vi.fn(() => ({
      origin: [0, 0, 0],
      spacing: [1, 1],
      dimensions: [16, 16],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })),
    worldToCanvas: vi.fn((p: number[]) => [(p[0] ?? 0) + 8, (p[1] ?? 0) + 8]),
    getActors: vi.fn(() => actors),
    removeAllActors: vi.fn(() => {
      actors = [];
    }),
    setBlendMode: vi.fn(),
    setSlabThickness: vi.fn(),
  };
}

/** MPR 三平面视口桩：轴向视口带 focalPoint（十字交点） */
function makeMprViewportStub(viewportId: string) {
  const props: Record<string, unknown> = { voiRange: { lower: -400, upper: 400 } };
  return {
    setStack: vi.fn(async () => {}),
    render: vi.fn(),
    setProperties: vi.fn((patch: Record<string, unknown>) => Object.assign(props, patch)),
    getProperties: vi.fn(() => ({ ...props })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() =>
      viewportId === 'mpr-axial' ? { parallelScale: 100, focalPoint: [0, 0, 2] } : { parallelScale: 100 },
    ),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    setImageIdIndex: vi.fn(),
    getRotation: vi.fn(() => 0),
    setRotation: vi.fn(),
    getActors: vi.fn(() => [{ uid: 'volume-actor' }]),
    removeAllActors: vi.fn(),
    setBlendMode: vi.fn(),
    setSlabThickness: vi.fn(),
    getSliceIndex: vi.fn(() => 0),
  };
}

async function flush(rounds = 14): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

function renderEngine() {
  const viewports: Record<
    string,
    | ReturnType<typeof makeStackViewportStub>
    | ReturnType<typeof makeMprViewportStub>
  > = {};
  const engine = {
    enableElement: vi.fn((input: { viewportId: string; type: string }) => {
      enabledInputs.push(input);
      return input;
    }),
    disableElement: vi.fn(),
    getViewport: vi.fn((viewportId: string) => {
      if (viewportId.startsWith('mpr-')) {
        return (viewports[viewportId] ??= makeMprViewportStub(viewportId));
      }
      return (viewports[viewportId] ??= makeStackViewportStub());
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

async function renderLoaded(count: number) {
  openDicomFilesMock.mockResolvedValue({
    opened: Array.from({ length: count }, (_, i) => makeOpenedFile(i + 1)),
    failures: [],
    cancelled: false,
  });
  const { engine, viewports } = renderEngine();
  const { default: App } = await import('../src/app/App');
  const view = await act(async () => render(<App />));
  await dropFiles(count);
  await flush();
  return { view, engine, viewports };
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

describe('App × MPR 参考线随动（FR-6.10）', () => {
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

  it('进入 MPR → 退出后，2D 视口绘制 MPR 平面交线叠加层', async () => {
    const { view } = await renderLoaded(3);
    // 初始无参考线
    expect(view.container.querySelector('.reference-lines-overlay')).toBeNull();

    // 进入 MPR
    fireEvent.click(findButton(view.container, 'MPR'));
    await flush();
    expect(view.baseElement.querySelector('.mpr-root')).toBeTruthy();

    // 退出 MPR：捕获轴向 camera.focalPoint [0,0,2] → 2D 视口出现参考线
    fireEvent.click(Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.includes('退出 MPR'))!);
    await flush();

    const overlay = view.container.querySelector('.reference-lines-overlay');
    expect(overlay).toBeTruthy();
    // 轴向视图：冠状（水平）+ 矢状（竖直）两条交线
    const lines = view.container.querySelectorAll('.reference-line');
    expect(lines.length).toBe(2);
  });

  it('清除/关闭参考线所属序列后叠加层消失', async () => {
    const { view } = await renderLoaded(3);
    fireEvent.click(findButton(view.container, 'MPR'));
    await flush();
    fireEvent.click(Array.from(view.container.querySelectorAll('button')).find((b) => b.textContent?.includes('退出 MPR'))!);
    await flush();
    expect(view.container.querySelectorAll('.reference-line').length).toBe(2);

    window.confirm = () => true;
    fireEvent.click(findButton(view.container, '清空全部'));
    await flush();
    expect(view.container.querySelector('.reference-lines-overlay')).toBeNull();
  });
});