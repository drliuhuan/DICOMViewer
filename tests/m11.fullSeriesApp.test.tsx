/**
 * M11 任务 1 App 集成（调用链证据）：
 * 「只打开部分文件（中途取消）→ 点 MPR → 弹序列选择器 → 选定序列 →
 *   完整目录补载（同序列未打开文件补齐）→ volume 用完整 imageIds 构建」。
 *
 * - 初次打开用桩实现模拟「取消后保留部分文件」；
 * - 目录重扫/解析/登记走真实实现（syntheticDicom 构造字节）；
 * - cornerstone core/tools 打桩，捕获 createAndCacheVolume 的 imageIds 与
 *   volume.load 调用（体素装载）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

const { getRenderingEngineMock, enabledInputs, createAndCacheVolumeSpy } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
  enabledInputs: [] as Array<{ viewportId: string; type: string }>,
  createAndCacheVolumeSpy: vi.fn(async (_volumeId: string, _options: unknown) => ({
    load: loadSpy,
  })),
}));
const loadSpy = vi.fn(async () => undefined);

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
  cache: {
    removeImageLoadObject: vi.fn(),
    purgeCache: vi.fn(),
    removeVolumeLoadObject: vi.fn(),
  },
  utilities: { scroll: vi.fn(), transformWorldToIndex: vi.fn() },
  getRenderingEngine: getRenderingEngineMock,
  setVolumesForViewports: vi.fn(async () => undefined),
  volumeLoader: {
    registerVolumeLoader: vi.fn(),
    createAndCacheVolume: createAndCacheVolumeSpy,
  },
  cornerstoneStreamingImageVolumeLoader: { streamLoader: true },
  metaData: { addProvider: vi.fn(), removeProvider: vi.fn(), get: vi.fn(() => undefined) },
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

vi.mock('../src/features/volume3d/gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/volume3d/gate')>();
  return { ...actual, hasWebGL2: () => true };
});

/**
 * 初次「打开文件夹」走真实扫描，但打开动作打桩：
 * 模拟用户在 6 个文件的目录中只解析到 2 个就点击了取消（cancelled=true）。
 */
let cancelAfterCount = 0;
vi.mock('../src/features/loading/openDicomFiles', async () => {
  const actualImageId = await vi.importActual<
    typeof import('../src/dicom/imageId')
  >('../src/dicom/imageId');
  const actualParse = await vi.importActual<
    typeof import('../src/dicom/parseDicom')
  >('../src/dicom/parseDicom');
  return {
    openDicomFiles: vi.fn(async (inputs: ReadonlyArray<{ file: File }>) => {
      const opened: OpenedDicomFile[] = [];
      for (let index = 0; index < Math.min(cancelAfterCount, inputs.length); index++) {
        const scanned = inputs[index]!;
        const buffer = await scanned.file.arrayBuffer();
        opened.push({
          fileName: scanned.file.name,
          fileSizeBytes: scanned.file.size,
          baseImageId: actualImageId.createDcmFileImageId(buffer),
          summary: actualParse.extractInstanceSummary(
            actualParse.parseDicomArrayBuffer(buffer),
          ),
        });
      }
      return { opened, failures: [], cancelled: true };
    }),
  };
});

import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

const SERIES_UID = '1.2.s';
const STUDY_UID = '1.2.study';

/**
 * syntheticDicom 的 SOPInstanceUID 为常量，测试需要逐实例唯一：
 * 等长替换其尾部三位数字（不改元素长度，不触碰共享 helper）。
 */
const SYNTHETIC_SOP_CONSTANT = '1.2.826.0.1.3680043.8.498.10002345987245';
function uniquifySopInstanceUid(buffer: ArrayBuffer, index: number): ArrayBuffer {
  const constant = new TextEncoder().encode(SYNTHETIC_SOP_CONSTANT);
  const bytes = new Uint8Array(buffer);
  const replacement = `${SYNTHETIC_SOP_CONSTANT.slice(0, -3)}${String(index).padStart(3, '0')}`;
  const patched = new TextEncoder().encode(replacement);
  let start = -1;
  outer: for (let i = 0; i <= bytes.length - constant.length; i++) {
    for (let j = 0; j < constant.length; j++) {
      if (bytes[i + j] !== constant[j]) {
        continue outer;
      }
    }
    start = i;
    break;
  }
  if (start >= 0) {
    bytes.set(patched, start);
  }
  return buffer;
}

/** 真实字节目录：同序列 6 个切片文件（SOP UID 逐文件唯一） */
function buildDirectoryHandle(): { name: string; values: () => AsyncIterable<never> } {
  const buffers = Array.from({ length: 6 }, (_, index) =>
    uniquifySopInstanceUid(
      buildSyntheticDicom({
        seriesInstanceUid: SERIES_UID,
        studyInstanceUid: STUDY_UID,
        instanceNumber: index + 1,
        sliceLocation: index * 2,
        imagePositionPatient: [0, 0, index * 2],
        pixelSpacing: [0.5, 0.5],
        rows: 8,
        columns: 8,
      }),
      index + 1,
    ),
  );
  const files = buffers.map(
    (buffer, index) => new File([buffer], `slice-${index + 1}.dcm`),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function* iterator(): any {
    for (const file of files) {
      yield {
        kind: 'file' as const,
        name: file.name,
        getFile: async () => file,
      };
    }
  }
  return {
    name: 'chest-ct-dir',
    values: () => iterator() as never,
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
    getSliceIndex: vi.fn(() => 0),
    getCanvas: vi.fn(() => ({ toDataURL: vi.fn(() => 'data:image/png;base64,AAA') })),
  };
}

async function flush(rounds = 14): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

describe('App × 完整序列进入 MPR（M11 任务 1）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    enabledInputs.length = 0;
    loadSpy.mockClear();
    createAndCacheVolumeSpy.mockClear();
    cancelAfterCount = 2;
    const handle = buildDirectoryHandle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.stubGlobal('window_showDirectoryPicker_unused', null);
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      writable: true,
      value: vi.fn(async () => handle),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

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
    return engine;
  }

  async function openFolderPartially(view: ReturnType<typeof render>) {
    const folderButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('打开文件夹'),
    );
    expect(folderButton).toBeDefined();
    fireEvent.click(folderButton!);
    await flush();
    // 部分加载后的状态栏应显示已统计实例数（2 个 = 中途取消保留部分）
    expect(await screen.findByText(/全部 2 个实例/)).toBeTruthy();
  }

  it('部分加载 → MPR 弹序列选择器 → 补载后 volume 用完整 imageIds 构建', async () => {
    renderEngine();
    const { default: App } = await import('../src/app/App');
    const view = await act(async () => render(<App />));
    await openFolderPartially(view);

    // 点 MPR：当前序列未核对完整性 → 弹出序列选择器
    const mprButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'MPR',
    )!;
    fireEvent.click(mprButton);
    const dialog = await screen.findByRole('dialog', { name: /进入 MPR：选择序列/ });
    expect(dialog).toBeTruthy();
    // 序列展示（synthetic 无描述 → 未命名序列）与层数/待核对提示
    expect(dialog.textContent).toContain('未命名序列');
    expect(dialog.textContent).toContain('CT');
    expect(dialog.textContent).toContain('2 层');
    expect(dialog.textContent).toContain('完整性待核对');

    // 确认进入 → 目录重扫补载 4 个缺失实例 → 进入三平面
    const confirmButton = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '确认进入',
    )!;
    fireEvent.click(confirmButton);
    await screen.findByText('MPR 三平面');

    // 体数据构建使用完整 imageIds（6 个），且 await 了 volume.load()
    await flush();
    expect(createAndCacheVolumeSpy).toHaveBeenCalledTimes(1);
    const call = createAndCacheVolumeSpy.mock.calls[0];
    const options = call?.[1] as { imageIds: string[] };
    expect(options.imageIds.length).toBe(6);
    const unique = new Set(options.imageIds.map((id) => id.split('?')[0]));
    expect(unique.size).toBe(6);
    expect(loadSpy).toHaveBeenCalledTimes(1);

    // 三个平面视口已启用
    const planeIds = enabledInputs
      .map((input) => input.viewportId)
      .filter((id) => id.startsWith('mpr-'));
    expect(planeIds.sort()).toEqual(['mpr-axial', 'mpr-coronal', 'mpr-sagittal']);
  }, 20000);
});
