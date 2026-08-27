/**
 * M11-F5 3D 面板 WW/WL 实时跟随 + 渲染预设恢复默认窗宽窗位。
 *
 * 根因（详见 src/features/volume3d/windowLevel3dTool.ts 头注释）：
 * 1. 中键拖动路径：内核部分视口架构（GenericViewport 的
 *    VolumeViewport3DLegacyAdapter.setProperties）不派发 VOI_MODIFIED，
 *    且面板输入框绑定 wwDraft/wlDraft、旧 VOI 监听只写 ww/wl state，
 *    输入框永远不跟随。修复 = WindowLevel3DTool 逐帧补发应用级事件
 *    VOLUME3D_VOI_CHANGED_EVENT + 面板双通道监听并统一更新草稿。
 * 2. 预设切换旧逻辑刻意保留当前 WW/WL（M10 行为）；M11-F5 语义改为
 *    重置为该预设默认值（presets.ts 的 ww/wl），初始挂载（ready 首跑）
 *    保持联动 2D/初始窗不变（FR-7.3 不破坏）。
 *
 * 手法：mock @cornerstonejs/core|tools + apply 的 vtk 装配（同
 * m10.vol3dViewport.test.tsx），断言调用链与面板 state/输入框。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { engine, windowLevelBaseCalls } = vi.hoisted(() => {
  function makeViewportStub(id: string) {
    return {
      id,
      getImageData: vi.fn(() => undefined),
      setProperties: vi.fn(),
      setSampleDistanceMultiplier: vi.fn(),
      resetCamera: vi.fn(),
      getCamera: vi.fn(() => ({ parallelProjection: false })),
      render: vi.fn(),
      getCanvas: vi.fn(() => ({ toDataURL: vi.fn(() => 'data:image/png;base64,AAA') })),
    };
  }
  const viewports: Record<string, ReturnType<typeof makeViewportStub>> = {};
  const engine = {
    enableElement: vi.fn(),
    getViewport: vi.fn((viewportId: string) => {
      const existing = viewports[viewportId];
      if (existing) {
        return existing;
      }
      const created = makeViewportStub(viewportId);
      viewports[viewportId] = created;
      return created;
    }),
    disableElement: vi.fn(),
    resize: vi.fn(),
  };
  return { engine, viewports, windowLevelBaseCalls: [] as unknown[] };
});

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { VOLUME_3D: 'volume3d', STACK: 'stack', ORTHOGRAPHIC: 'orthographic' },
    Events: {
      VOI_MODIFIED: 'CORNERSTONE_VOI_MODIFIED',
      CAMERA_MODIFIED: 'CORNERSTONE_CAMERA_MODIFIED',
    },
  },
  RenderingEngine: class RenderingEngine {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  cache: { removeVolumeLoadObject: vi.fn() },
  getRenderingEngine: vi.fn(() => engine),
  setVolumesForViewports: vi.fn(async () => undefined),
  // WindowLevel3DTool 拖动回调内读取视口（单测按用例注入返回值）
  getEnabledElement: vi.fn(),
}));

vi.mock('@cornerstonejs/tools', () => {
  function defineTool(name: string) {
    return class {
      static toolName = name;
    };
  }
  // WindowLevel3DTool 的父类桩：原型方法（super 调用可达），记录调用
  class WindowLevelToolStub {
    static toolName = 'WindowLevel';
    mouseDragCallback(evt: unknown): void {
      windowLevelBaseCalls.push(evt);
    }
  }
  return {
    Enums: {
      MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 },
      KeyboardBindings: { Ctrl: 17 },
    },
    init: vi.fn(),
    addTool: vi.fn(),
    TrackballRotateTool: defineTool('TrackballRotate'),
    PanTool: defineTool('Pan'),
    ZoomTool: defineTool('Zoom'),
    WindowLevelTool: WindowLevelToolStub,
    OrientationMarkerTool: defineTool('OrientationMarker'),
    ToolGroupManager: {
      createToolGroup: vi.fn(() => ({
        id: 'g',
        addViewport: vi.fn(),
        addTool: vi.fn(),
        setToolActive: vi.fn(),
      })),
      destroyToolGroup: vi.fn(),
    },
  };
});

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

const applyMocks = vi.hoisted(() => ({
  applyPresetToViewport: vi.fn(async () => true),
  applySampleDistanceMultiplier: vi.fn(),
  applyWwWlToViewport: vi.fn(),
  applyClippingToViewport: vi.fn(async () => true),
  resetVolume3dCamera: vi.fn(),
  screenshotVolume3d: vi.fn(() => 'data:image/png;base64,AAA'),
}));

vi.mock('../src/features/volume3d/apply', () => applyMocks);

import { getEnabledElement } from '@cornerstonejs/core';
import { Volume3dViewport } from '../src/features/volume3d/Volume3dViewport';
import {
  VOLUME3D_VOI_CHANGED_EVENT,
  WindowLevel3DTool,
  wwWlFromVoiRange,
} from '../src/features/volume3d/windowLevel3dTool';
import type { MprVolumeBuildDeps } from '../src/features/mpr/mprVolume';
import type { SeriesStack, StackItem } from '../src/features/series/buildStacks';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';

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
        modality: 'CT',
        seriesInstanceUid: '1.2.s',
        instanceNumber: i,
        pixelSpacing: [0.5, 0.5],
        imagePositionPatient: [0, 0, (i - 1) * 2],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        frameOfReferenceUid: '1.2.f',
        rows: 16,
        columns: 16,
        bitsAllocated: 16,
        numberOfFrames: 1,
        sopInstanceUid: `sop${i}`,
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
    createVolume: vi.fn(async () => ({ volumeId: 'vol3d-volume:1.2.s' })),
    installFrameIpp: vi.fn(async () => () => undefined),
    imageIdsOf: (stack) => [...stack.items.map((item) => item.imageId)],
  };
}

function wwWlInputs(): { ww: HTMLInputElement; wl: HTMLInputElement } {
  return {
    ww: screen.getByLabelText('3D 窗宽') as HTMLInputElement,
    wl: screen.getByLabelText('3D 窗位') as HTMLInputElement,
  };
}

async function renderReady(options?: {
  linkedWwWl?: { ww: number; wl: number };
  onSyncWwWlTo2D?: (ww: number, wl: number) => void;
}) {
  const view = render(
    <Volume3dViewport
      stack={makeStack(2)}
      seriesUid="1.2.s"
      showInfo={false}
      linkedWwWl={options?.linkedWwWl}
      onSyncWwWlTo2D={options?.onSyncWwWlTo2D}
      onExitVolume3d={vi.fn()}
      volumeDeps={makeVolumeDeps()}
      webgl2
    />,
  );
  await waitFor(() => {
    expect(engine.enableElement).toHaveBeenCalledTimes(1);
  });
  await screen.findByText('3D 体绘制');
  return view;
}

function cornerstoneElement(container: HTMLElement): HTMLDivElement {
  const element = container.querySelector<HTMLDivElement>('.cornerstone-element');
  if (!element) {
    throw new Error('cornerstone-element 缺失');
  }
  return element;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  windowLevelBaseCalls.length = 0;
  vi.mocked(getEnabledElement).mockReset();
});

describe('WindowLevel3DTool（M11-F5 中键拖动逐帧补发 VOI 事件）', () => {
  function makeEvt(element: HTMLDivElement) {
    return {
      detail: { element, deltaPoints: { canvas: [3, -2] as [number, number] } },
    };
  }

  it('super 生效后读取视口 voiRange 并派发 VOLUME3D_VOI_CHANGED_EVENT', () => {
    vi.mocked(getEnabledElement).mockReturnValue({
      viewport: {
        id: 'vol3d-main',
        getProperties: () => ({ voiRange: { lower: -100, upper: 900 } }),
      },
    } as never);
    const tool = new WindowLevel3DTool();
    const element = document.createElement('div');
    const listener = vi.fn();
    element.addEventListener(VOLUME3D_VOI_CHANGED_EVENT, listener);

    tool.mouseDragCallback(makeEvt(element));

    // 内核调窗逻辑先执行（生效画面），随后补发面板事件
    expect(windowLevelBaseCalls).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent;
    expect(event.type).toBe(VOLUME3D_VOI_CHANGED_EVENT);
    expect(event.detail).toEqual({
      viewportId: 'vol3d-main',
      ww: 1000,
      wl: 400,
      range: { lower: -100, upper: 900 },
    });
  });

  it('拖动中逐帧派发：每次 mouseDragCallback 各派发一次且值随视口更新', () => {
    const ranges = [
      { lower: -100, upper: 900 },
      { lower: -500, upper: 700 },
    ];
    let call = 0;
    vi.mocked(getEnabledElement).mockReturnValue({
      viewport: {
        id: 'vol3d-main',
        getProperties: () => ({ voiRange: ranges[Math.min(call++, ranges.length - 1)] }),
      },
    } as never);
    const tool = new WindowLevel3DTool();
    const element = document.createElement('div');
    const listener = vi.fn();
    element.addEventListener(VOLUME3D_VOI_CHANGED_EVENT, listener);

    tool.mouseDragCallback(makeEvt(element));
    tool.mouseDragCallback(makeEvt(element));

    expect(windowLevelBaseCalls).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail.ww).toBe(1000);
    expect((listener.mock.calls[1]?.[0] as CustomEvent).detail).toEqual({
      viewportId: 'vol3d-main',
      ww: 1200,
      wl: 100,
      range: { lower: -500, upper: 700 },
    });
  });

  it('内核调窗抛错时静默中断（不派发事件、不外抛）', () => {
    vi.mocked(getEnabledElement).mockReturnValue({
      viewport: { id: 'vol3d-main', getProperties: () => ({ voiRange: { lower: 0, upper: 1 } }) },
    } as never);
    // 拦截 super 调用：派生类的构造函数原型即父类构造器，取其 prototype 方法
    const parent = Object.getPrototypeOf(WindowLevel3DTool) as {
      prototype: { mouseDragCallback: (evt: unknown) => void };
    };
    const baseSpy = vi.spyOn(parent.prototype, 'mouseDragCallback').mockImplementation(() => {
      throw new Error('kernel boom');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tool = new WindowLevel3DTool();
      const element = document.createElement('div');
      const listener = vi.fn();
      element.addEventListener(VOLUME3D_VOI_CHANGED_EVENT, listener);

      expect(() => tool.mouseDragCallback(makeEvt(element))).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      baseSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('视口缺 voiRange（异常态）时跳过派发且不外抛', () => {
    vi.mocked(getEnabledElement).mockReturnValue({
      viewport: { id: 'vol3d-main', getProperties: () => ({}) },
    } as never);
    const tool = new WindowLevel3DTool();
    const element = document.createElement('div');
    const listener = vi.fn();
    element.addEventListener(VOLUME3D_VOI_CHANGED_EVENT, listener);

    expect(() => tool.mouseDragCallback(makeEvt(element))).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('wwWlFromVoiRange：WW/WL 换算保留 2 位小数', () => {
    expect(wwWlFromVoiRange({ lower: -951.78, upper: 1516.34 })).toEqual({
      ww: 2468.12,
      wl: 282.28,
    });
  });
});

describe('3D 面板 WW/WL 实时跟随（M11-F5）', () => {
  it('自定义 VOI 事件 → 面板输入框实时更新（拖动中逐帧）', async () => {
    const { container } = await renderReady();
    const element = cornerstoneElement(container);
    const inputs = wwWlInputs();

    act(() => {
      element.dispatchEvent(
        new CustomEvent(VOLUME3D_VOI_CHANGED_EVENT, {
          detail: {
            viewportId: 'vol3d-main',
            ww: 1234.56,
            wl: -200,
            range: { lower: -717.28, upper: 517.28 },
          },
        }),
      );
    });
    expect(inputs.ww.value).toBe('1234.56');
    expect(inputs.wl.value).toBe('-200');

    // 第二帧：跟随最新值
    act(() => {
      element.dispatchEvent(
        new CustomEvent(VOLUME3D_VOI_CHANGED_EVENT, {
          detail: {
            viewportId: 'vol3d-main',
            ww: 800,
            wl: 100,
            range: { lower: -300, upper: 500 },
          },
        }),
      );
    });
    expect(inputs.ww.value).toBe('800');
    expect(inputs.wl.value).toBe('100');
  });

  it('非 3D 视口的事件被过滤（viewportId 不匹配不更新）', async () => {
    const { container } = await renderReady();
    const element = cornerstoneElement(container);
    const inputs = wwWlInputs();

    act(() => {
      element.dispatchEvent(
        new CustomEvent(VOLUME3D_VOI_CHANGED_EVENT, {
          detail: { viewportId: 'vp-other', ww: 1, wl: 2, range: { lower: -1, upper: 0 } },
        }),
      );
    });
    expect(inputs.ww.value).toBe('2500');
    expect(inputs.wl.value).toBe('500');
  });

  it('内核 VOI_MODIFIED 路径（resetProperties 等）仍更新面板', async () => {
    const { container } = await renderReady();
    const element = cornerstoneElement(container);

    act(() => {
      element.dispatchEvent(
        new CustomEvent('CORNERSTONE_VOI_MODIFIED', {
          detail: { viewportId: 'vol3d-main', range: { lower: -800, upper: 1200 } },
        }),
      );
    });
    const inputs = wwWlInputs();
    expect(inputs.ww.value).toBe('2000');
    expect(inputs.wl.value).toBe('200');
  });
});

describe('渲染预设恢复默认窗宽窗位（M11-F5）', () => {
  it('切换预设后 WW/WL 重置为预设默认值（视口应用 + 面板输入框）', async () => {
    await renderReady();
    // 初始（ct-bone 默认预设）面板为 2500/500
    let inputs = wwWlInputs();
    expect(inputs.ww.value).toBe('2500');
    expect(inputs.wl.value).toBe('500');

    fireEvent.change(screen.getByLabelText('3D 渲染预设'), {
      target: { value: 'mip' },
    });
    // 预设默认 ww=1500/wl=600：同步应用到视口并刷新面板
    await waitFor(() => {
      expect(applyMocks.applyWwWlToViewport).toHaveBeenLastCalledWith(
        expect.anything(),
        1500,
        600,
      );
    });
    inputs = wwWlInputs();
    expect(inputs.ww.value).toBe('1500');
    expect(inputs.wl.value).toBe('600');
  });

  it('预设切换覆盖用户当前窗宽窗位（旧行为为保留，语义修正）', async () => {
    await renderReady();
    const inputs = wwWlInputs();
    fireEvent.change(inputs.ww, { target: { value: '400' } });
    fireEvent.change(inputs.wl, { target: { value: '40' } });
    fireEvent.blur(inputs.ww);
    expect(applyMocks.applyWwWlToViewport).toHaveBeenLastCalledWith(
      expect.anything(),
      400,
      40,
    );

    fireEvent.change(screen.getByLabelText('3D 渲染预设'), {
      target: { value: 'ct-angio' },
    });
    await waitFor(() => {
      expect(applyMocks.applyWwWlToViewport).toHaveBeenLastCalledWith(
        expect.anything(),
        800,
        300,
      );
    });
    expect(wwWlInputs().ww.value).toBe('800');
    expect(wwWlInputs().wl.value).toBe('300');
  });

  it('初始挂载（ready 首跑）保持联动 2D 初始窗，不重置为预设默认（FR-7.3 不破坏）', async () => {
    await renderReady({ linkedWwWl: { ww: 800, wl: 400 } });
    await waitFor(() => {
      // 预设 effect 首跑后仍以联动值收尾（而非 ct-bone 默认 2500/500）
      expect(applyMocks.applyWwWlToViewport).toHaveBeenLastCalledWith(
        expect.anything(),
        800,
        400,
      );
    });
    const inputs = wwWlInputs();
    expect(inputs.ww.value).toBe('800');
    expect(inputs.wl.value).toBe('400');
  });

  it('2D→3D 联动值同步到输入框（草稿跟随，M11-F5 统一更新）', async () => {
    const { rerender } = await renderReady({ linkedWwWl: { ww: 800, wl: 400 } });
    fireEvent.click(screen.getByLabelText('3D 窗宽窗位联动 2D'));
    rerender(
      <Volume3dViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        linkedWwWl={{ ww: 1000, wl: 500 }}
        onSyncWwWlTo2D={vi.fn()}
        onExitVolume3d={vi.fn()}
        volumeDeps={makeVolumeDeps()}
        webgl2
      />,
    );
    await waitFor(() => {
      expect(applyMocks.applyWwWlToViewport).toHaveBeenLastCalledWith(
        expect.anything(),
        1000,
        500,
      );
    });
    const inputs = wwWlInputs();
    expect(inputs.ww.value).toBe('1000');
    expect(inputs.wl.value).toBe('500');
  });
});
