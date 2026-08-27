/**
 * M11-F4 屏蔽视口右键菜单：2D（DicomViewport，含 ViewerCell 包装）/ MPR
 * （MprViewport 三平面）/ 3D（Volume3dViewport）的 cornerstone-element
 * 容器对 contextmenu 事件 preventDefault（浏览器原生菜单不再弹出，
 * 右键拖动翻层/滚层/旋转不被干扰）。同时锁定：
 * - 非全局屏蔽：视口外（document.body）右键默认行为不受影响，
 *   面板内右键粘贴等浏览器能力保留；
 * - 只挡菜单不挡事件流：右键 mousedown/mousemove/mouseup 仍正常冒泡至
 *   window，contextmenu 自身也仍冒泡（preventDefault 不阻断传播），
 *   cornerstone 右键交互链路不受影响。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + 工具装配/apply）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';

const { getRenderingEngineMock } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack', ORTHOGRAPHIC: 'orthographic', VOLUME_3D: 'volume3d' },
    OrientationAxis: { AXIAL: 'axial', CORONAL: 'coronal', SAGITTAL: 'sagittal' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'cornerstonestackviewportscroll',
      VOLUME_NEW_IMAGE: 'cornerstonevolumenewimage',
      VOI_MODIFIED: 'cornerstonevoimodified',
      CAMERA_MODIFIED: 'cornerstonecameramodified',
    },
    BlendModes: {
      AVERAGE_INTENSITY_BLEND: 0,
      MAXIMUM_INTENSITY_BLEND: 1,
      MINIMUM_INTENSITY_BLEND: 2,
    },
  },
  RenderingEngine: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  cache: { removeVolumeLoadObject: vi.fn() },
  utilities: { scroll: vi.fn(), transformWorldToIndex: vi.fn() },
  getRenderingEngine: getRenderingEngineMock,
  setVolumesForViewports: vi.fn(async () => undefined),
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
    TrackballRotateTool: defineTool('TrackballRotate'),
    OrientationMarkerTool: defineTool('OrientationMarker'),
    LengthTool: defineTool('Length'),
    AngleTool: defineTool('Angle'),
    RectangleROITool: defineTool('RectangleROI'),
    EllipticalROITool: defineTool('EllipticalROI'),
    ProbeTool: defineTool('Probe'),
    ToolGroupManager: {
      createToolGroup: vi.fn(() => ({
        id: 'tg-stub',
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

vi.mock('../src/features/viewer/toolSetup', () => ({
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: vi.fn((_engineId: string, viewportId: string) => ({
    id: `tg-${viewportId}`,
  })),
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

vi.mock('../src/features/volume3d/apply', () => ({
  applyPresetToViewport: vi.fn(async () => true),
  applySampleDistanceMultiplier: vi.fn(),
  applyWwWlToViewport: vi.fn(),
  applyClippingToViewport: vi.fn(async () => true),
  resetVolume3dCamera: vi.fn(),
  screenshotVolume3d: vi.fn(() => 'data:image/png;base64,AAA'),
}));

import { DicomViewport } from '../src/features/viewer/DicomViewport';
import { ViewerCell } from '../src/features/viewer/ViewerCell';
import { MprViewport } from '../src/features/mpr/MprViewport';
import { Volume3dViewport } from '../src/features/volume3d/Volume3dViewport';
import type { MprVolumeBuildDeps } from '../src/features/mpr/mprVolume';
import type { SeriesStack, StackItem } from '../src/features/series/buildStacks';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

/** 引擎替身：按 viewportId 惰性创建视口桩（满足挂载/卸载调用链即可） */
function makeViewportStub() {
  return {
    getImageData: vi.fn(() => undefined),
    setProperties: vi.fn(),
    setSampleDistanceMultiplier: vi.fn(),
    setBlendMode: vi.fn(),
    setSlabThickness: vi.fn(),
    getZoom: vi.fn(() => 1),
    getCamera: vi.fn(() => ({ parallelScale: 100, parallelProjection: false })),
    render: vi.fn(),
    getCanvas: vi.fn(() => ({ toDataURL: vi.fn(() => 'data:image/png;base64,AAA') })),
  };
}

const viewports: Record<string, ReturnType<typeof makeViewportStub>> = {};
const engine = {
  enableElement: vi.fn(),
  disableElement: vi.fn(),
  resize: vi.fn(),
  getViewport: vi.fn((viewportId: string) => {
    const existing = viewports[viewportId];
    if (existing) {
      return existing;
    }
    const created = makeViewportStub();
    viewports[viewportId] = created;
    return created;
  }),
};

function makeStack(itemCount: number): SeriesStack {
  const items: StackItem[] = [];
  for (let i = 1; i <= itemCount; i += 1) {
    items.push({
      imageId: `dcm-file://k${i}`,
      fileName: `k${i}.dcm`,
      frameNumber: 1,
      summary: {
        patientName: '张^三',
        patientId: 'P1',
        patientSex: undefined,
        patientAge: undefined,
        modality: 'CT',
        studyInstanceUid: undefined,
        studyDate: undefined,
        studyDescription: undefined,
        institutionName: undefined,
        seriesInstanceUid: '1.2.s',
        seriesNumber: undefined,
        seriesDescription: undefined,
        instanceNumber: i,
        sliceLocation: undefined,
        sliceThickness: 1.25,
        pixelSpacing: [0.5, 0.5],
        imagePositionPatient: [0, 0, (i - 1) * 2],
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
        sopInstanceUid: `sop${i}`,
        transferSyntaxUid: undefined,
      } as DicomInstanceSummary,
    });
  }
  return {
    seriesUid: '1.2.s',
    modality: 'CT',
    description: undefined,
    items,
    patientId: 'P1',
    patientName: '张^三',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
  };
}

function makeVolumeDeps(): MprVolumeBuildDeps {
  return {
    ensureMetadata: vi.fn(async () => undefined),
    registerVolumeLoader: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => ({ volumeId: 'mpr-volume:1.2.s' })),
    installFrameIpp: vi.fn(async () => () => undefined),
    imageIdsOf: (stack) => [...stack.items.map((item) => item.imageId)],
  };
}

async function settle(rounds = 8): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

/** 在元素上派发可取消的 contextmenu 原生事件并返回该事件对象 */
function dispatchContextMenu(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  getRenderingEngineMock.mockReturnValue(engine);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('M11-F4 屏蔽视口右键菜单（2D DicomViewport）', () => {
  it('cornerstone-element 容器 contextmenu 被 preventDefault', async () => {
    const { container } = render(
      <DicomViewport viewportId="vp-0" items={[]} showInfo={false} />,
    );
    await settle();

    const element = container.querySelector('.cornerstone-element');
    expect(element).toBeTruthy();
    const event = dispatchContextMenu(element!);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ViewerCell 包装的 2D 视格（App 实际渲染路径）同样屏蔽', async () => {
    const { container } = render(
      <ViewerCell
        viewportId="vp-0"
        items={[]}
        showInfo={false}
        isActive={false}
        badgeLabel={null}
        onActivate={vi.fn()}
        registerApi={vi.fn()}
        onUiChange={vi.fn()}
      />,
    );
    await settle();

    const element = container.querySelector('.cornerstone-element');
    expect(element).toBeTruthy();
    const event = dispatchContextMenu(element!);
    expect(event.defaultPrevented).toBe(true);
  });

  it('非全局屏蔽：视口外（document.body）右键默认行为不受影响', async () => {
    render(<DicomViewport viewportId="vp-0" items={[]} showInfo={false} />);
    await settle();

    const event = dispatchContextMenu(document.body);
    expect(event.defaultPrevented).toBe(false);
  });

  it('只挡菜单不挡事件流：右键 mousedown/mousemove/mouseup 仍冒泡至 window', async () => {
    const { container } = render(
      <DicomViewport viewportId="vp-0" items={[]} showInfo={false} />,
    );
    await settle();
    const element = container.querySelector('.cornerstone-element')!;

    const seen: string[] = [];
    const record = (event: Event) => {
      seen.push(event.type);
    };
    window.addEventListener('mousedown', record);
    window.addEventListener('mousemove', record);
    window.addEventListener('mouseup', record);
    try {
      for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
        element.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 }),
        );
      }
    } finally {
      window.removeEventListener('mousedown', record);
      window.removeEventListener('mousemove', record);
      window.removeEventListener('mouseup', record);
    }
    expect(seen).toEqual(['mousedown', 'mousemove', 'mouseup']);
  });

  it('preventDefault 不阻断传播：contextmenu 仍冒泡至 window', async () => {
    const { container } = render(
      <DicomViewport viewportId="vp-0" items={[]} showInfo={false} />,
    );
    await settle();
    const element = container.querySelector('.cornerstone-element')!;

    const onWindowContextMenu = vi.fn();
    window.addEventListener('contextmenu', onWindowContextMenu);
    try {
      const event = dispatchContextMenu(element);
      expect(onWindowContextMenu).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      window.removeEventListener('contextmenu', onWindowContextMenu);
    }
  });
});

describe('M11-F4 屏蔽视口右键菜单（MPR MprViewport 三平面）', () => {
  it('轴向/冠状/矢状三个 cornerstone-element 容器 contextmenu 均被 preventDefault', async () => {
    const { container } = render(
      <MprViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );
    // 等三平面视口挂载完成（与真实交互路径一致后再断言）
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(3);
    });

    const elements = container.querySelectorAll('.cornerstone-element');
    expect(elements.length).toBe(3);
    for (const element of elements) {
      const event = dispatchContextMenu(element);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});

describe('M11-F4 屏蔽视口右键菜单（3D Volume3dViewport）', () => {
  it('cornerstone-element 容器 contextmenu 被 preventDefault', async () => {
    const { container } = render(
      <Volume3dViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        onExitVolume3d={vi.fn()}
        volumeDeps={makeVolumeDeps()}
        webgl2
      />,
    );
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(1);
    });

    const element = container.querySelector('.cornerstone-element');
    expect(element).toBeTruthy();
    const event = dispatchContextMenu(element!);
    expect(event.defaultPrevented).toBe(true);
  });
});
