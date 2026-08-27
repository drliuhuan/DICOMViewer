/**
 * M10-C Volume3dViewport 组件（FR-7.1/7.2/7.3/7.7/7.8/7.9/7.12）：
 * VOLUME_3D 视口 enable、volume 构建与装载、预设下拉/复位视角/截图/
 * 质量档位/窗宽窗位联动、卸载释放 的调用链断言。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + apply 的 vtk 装配）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { engine } = vi.hoisted(() => {
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
    // M11-F2：容器尺寸自适应（ResizeObserver → resize(immediate, keepCamera)）
    resize: vi.fn(),
  };
  return { engine, viewports };
});

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { VOLUME_3D: 'volume3d', STACK: 'stack', ORTHOGRAPHIC: 'orthographic' },
    Events: {
      VOLUME_NEW_IMAGE: 'CORNERSTONE_VOLUME_NEW_IMAGE',
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
  // M11-F5：windowLevel3dTool 静态引用（本文件不触发拖动，仅补齐导出）
  getEnabledElement: vi.fn(),
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
    TrackballRotateTool: defineTool('TrackballRotate'),
    PanTool: defineTool('Pan'),
    ZoomTool: defineTool('Zoom'),
    // M11-F3：3D ToolGroup 新增中键窗宽窗位
    WindowLevelTool: defineTool('WindowLevel'),
    OrientationMarkerTool: defineTool('OrientationMarker'),
    ToolGroupManager: {
      createToolGroup: vi.fn((id: string) => {
        const group = { id, addViewport: vi.fn(), addTool: vi.fn(), setToolActive: vi.fn() };
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

const applyMocks = vi.hoisted(() => ({
  applyPresetToViewport: vi.fn(async () => true),
  applySampleDistanceMultiplier: vi.fn(),
  applyWwWlToViewport: vi.fn(),
  applyClippingToViewport: vi.fn(async () => true),
  resetVolume3dCamera: vi.fn(),
  screenshotVolume3d: vi.fn(() => 'data:image/png;base64,AAA'),
}));

vi.mock('../src/features/volume3d/apply', () => applyMocks);

import * as core from '@cornerstonejs/core';
import { Volume3dViewport } from '../src/features/volume3d/Volume3dViewport';
import { findVolume3dPreset } from '../src/features/volume3d/presets';
import { VOLUME3D_QUALITY_MULTIPLIER } from '../src/features/volume3d/quality';
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
    createVolume: vi.fn(async () => ({ volumeId: 'vol3d-volume:1.2.s' })),
    installFrameIpp: vi.fn(async () => () => undefined),
    imageIdsOf: (stack) => [...stack.items.map((item) => item.imageId)],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Volume3dViewport 挂载/初始化（FR-7.1）', () => {
  it('启用 VOLUME_3D 视口（vol3d-main）并构建装载体数据', async () => {
    const stack = makeStack(3);
    const volumeDeps = makeVolumeDeps();
    render(
      <Volume3dViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitVolume3d={vi.fn()}
        volumeDeps={volumeDeps}
        webgl2
      />,
    );

    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(1);
    });
    const input = engine.enableElement.mock.calls[0]?.[0] as {
      viewportId: string;
      type: string;
    };
    expect(input.viewportId).toBe('vol3d-main');
    expect(input.type).toBe('volume3d');

    await waitFor(() => {
      expect(volumeDeps.createVolume).toHaveBeenCalledTimes(1);
    });
    expect(volumeDeps.createVolume).toHaveBeenCalledWith('vol3d-volume:1.2.s', {
      imageIds: ['dcm-file://k1', 'dcm-file://k2', 'dcm-file://k3'],
    });

    await waitFor(() => {
      expect(core.setVolumesForViewports).toHaveBeenCalledTimes(1);
    });
    expect(core.setVolumesForViewports).toHaveBeenCalledWith(
      engine,
      [{ volumeId: 'vol3d-volume:1.2.s' }],
      ['vol3d-main'],
    );
  });

  it('WebGL2 缺失时显示错误并给出返回入口（FR-7.1 门槛）', async () => {
    render(
      <Volume3dViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        onExitVolume3d={vi.fn()}
        volumeDeps={makeVolumeDeps()}
        webgl2={false}
      />,
    );
    expect(await screen.findByText(/不支持 WebGL2/)).toBeTruthy();
    expect(engine.enableElement).not.toHaveBeenCalled();
    expect(core.cache.removeVolumeLoadObject).not.toHaveBeenCalled();
  });
});

describe('Volume3dViewport 预设/复位/截图/质量（FR-7.2/7.9/7.8/7.7）', () => {
  async function renderReady() {
    render(
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
    await screen.findByText('3D 体绘制');
  }

  it('渲染工具栏：预设下拉、质量、WW/WL、裁剪、复位、截图、退出', async () => {
    await renderReady();
    expect(screen.getByLabelText('3D 渲染预设')).toBeTruthy();
    const presetSelect = screen.getByLabelText('3D 渲染预设') as HTMLSelectElement;
    expect(presetSelect.options.length).toBe(5);
    expect(screen.getByLabelText('3D 渲染质量')).toBeTruthy();
    expect(screen.getByText('复位视角')).toBeTruthy();
    expect(screen.getByText('截图')).toBeTruthy();
    expect(screen.getByText('退出 3D')).toBeTruthy();
  });

  it('挂载就绪后应用默认预设（CT-Bone）并复位轴位俯视视角', async () => {
    await renderReady();
    await waitFor(() => {
      expect(applyMocks.applyPresetToViewport).toHaveBeenCalled();
    });
    const preset = findVolume3dPreset('ct-bone');
    const lastCall = applyMocks.applyPresetToViewport.mock.calls[
      applyMocks.applyPresetToViewport.mock.calls.length - 1
    ] as unknown as [object, { id: string }];
    expect(lastCall[1].id).toBe(preset!.id);
    expect(applyMocks.resetVolume3dCamera).toHaveBeenCalled();
  });

  it('切换预设：调用 vtk 装配逻辑应用对应预设', async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText('3D 渲染预设'), {
      target: { value: 'mip' },
    });
    await waitFor(() => {
      const call = applyMocks.applyPresetToViewport.mock.calls[
        applyMocks.applyPresetToViewport.mock.calls.length - 1
      ] as unknown as [object, { id: string }];
      expect(call[1].id).toBe('mip');
    });
  });

  it('复位视角按钮触发 resetVolume3dCamera（FR-7.9）', async () => {
    await renderReady();
    applyMocks.resetVolume3dCamera.mockClear();
    fireEvent.click(screen.getByText('复位视角'));
    expect(applyMocks.resetVolume3dCamera).toHaveBeenCalled();
  });

  it('截图按钮触发 PNG 导出（FR-7.8）', async () => {
    await renderReady();
    fireEvent.click(screen.getByText('截图'));
    expect(applyMocks.screenshotVolume3d).toHaveBeenCalledTimes(1);
  });

  it('切换质量档位应用对应采样距离倍数（FR-7.7）', async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText('3D 渲染质量'), {
      target: { value: 'high' },
    });
    expect(applyMocks.applySampleDistanceMultiplier).toHaveBeenLastCalledWith(
      expect.anything(),
      VOLUME3D_QUALITY_MULTIPLIER.high,
    );
  });
});

describe('Volume3dViewport 窗宽窗位联动（FR-7.3）', () => {
  async function renderReady(linkedWwWl?: { ww: number; wl: number }, onSync?: (ww: number, wl: number) => void) {
    render(
      <Volume3dViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        linkedWwWl={linkedWwWl}
        onSyncWwWlTo2D={onSync}
        onExitVolume3d={vi.fn()}
        volumeDeps={makeVolumeDeps()}
        webgl2
      />,
    );
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('3D 体绘制');
  }

  it('提交窗宽窗位应用到体绘制映射（实时影响）', async () => {
    await renderReady();
    const wwInput = screen.getByLabelText('3D 窗宽');
    const wlInput = screen.getByLabelText('3D 窗位');
    fireEvent.change(wwInput, { target: { value: '400' } });
    fireEvent.change(wlInput, { target: { value: '40' } });
    fireEvent.blur(wwInput);
    expect(applyMocks.applyWwWlToViewport).toHaveBeenLastCalledWith(
      expect.anything(),
      400,
      40,
    );
  });

  it('联动 2D 开启：3D 提交同时推送到 2D 回调', async () => {
    const onSync = vi.fn();
    await renderReady(undefined, onSync);
    fireEvent.click(screen.getByLabelText('3D 窗宽窗位联动 2D'));
    const wwInput = screen.getByLabelText('3D 窗宽');
    const wlInput = screen.getByLabelText('3D 窗位');
    fireEvent.change(wwInput, { target: { value: '600' } });
    fireEvent.change(wlInput, { target: { value: '100' } });
    fireEvent.keyDown(wwInput, { key: 'Enter' });
    expect(onSync).toHaveBeenCalledWith(600, 100);
  });

  it('联动 2D 开启：2D 窗宽窗位变化应用到 3D（去重防循环）', async () => {
    const { rerender } = render(
      <Volume3dViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        linkedWwWl={{ ww: 800, wl: 400 }}
        onSyncWwWlTo2D={vi.fn()}
        onExitVolume3d={vi.fn()}
        volumeDeps={makeVolumeDeps()}
        webgl2
      />,
    );
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(1);
    });
    await screen.findByText('3D 体绘制');
    fireEvent.click(screen.getByLabelText('3D 窗宽窗位联动 2D'));
    applyMocks.applyWwWlToViewport.mockClear();

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
  });
});

describe('Volume3dViewport 卸载释放（FR-7.12）', () => {
  it('退出：销毁 ToolGroup、禁用视口、释放 volume 缓存与逐帧 provider', async () => {
    const stack = makeStack(2);
    const removeVolumeLoadObject = vi.mocked(core.cache.removeVolumeLoadObject);
    const destroyToolGroup = vi.mocked(
      (await import('@cornerstonejs/tools')).ToolGroupManager.destroyToolGroup,
    );
    const { unmount } = render(
      <Volume3dViewport
        stack={stack}
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

    unmount();

    await waitFor(() => {
      expect(removeVolumeLoadObject).toHaveBeenCalledWith('vol3d-volume:1.2.s');
    });
    expect(destroyToolGroup).toHaveBeenCalledWith('dicom-viewer-m1-engine:vol3d');
    expect(engine.disableElement).toHaveBeenCalledWith('vol3d-main');
  });
});

describe('Volume3dViewport 容器结构/尺寸自适应（M11-F2 黑屏修复）', () => {
  /**
   * 根因回归锁定：3D 布局的 `.viewport-cell` 曾直接挂在 `.mpr-grid-wrap`
   * （flex 子级、min-height:0）下而缺 `.viewer-grid`（display:grid +
   * 宽高 100%）包装 → block 级 cell 高度由内容决定 → canvas 容器 0 高
   * → vtk 按 0 高创建 canvas → 主显示区全黑。
   * 尺寸自适应与 tests/m1.viewportResize.test.tsx 同款手法：mock
   * ResizeObserver + 手动驱动 rAF。
   */
  class ResizeObserverMock {
    static instances: ResizeObserverMock[] = [];
    observe = vi.fn();
    disconnect = vi.fn();
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      ResizeObserverMock.instances.push(this);
    }
    trigger(): void {
      this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
  }

  let rafCallbacks: Array<() => void>;
  function flushRaf(): void {
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const cb of pending) {
      cb();
    }
  }

  beforeEach(() => {
    ResizeObserverMock.instances = [];
    rafCallbacks = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverMock as unknown as typeof ResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderReady() {
    const view = render(
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
    await screen.findByText('3D 体绘制');
    return view;
  }

  it('容器层级：mpr-grid-wrap > viewer-grid > viewport-cell > cornerstone-element（不允许 wrap 直接子级 cell）', async () => {
    const { container } = await renderReady();
    const wrap = container.querySelector<HTMLDivElement>('.mpr-grid-wrap');
    expect(wrap).toBeTruthy();

    // .viewport-cell 必须包在 .viewer-grid 内且撑满（单行/单列 minmax(0,1fr)）
    const grid = Array.from(wrap!.children).find((child) =>
      child.classList.contains('viewer-grid'),
    ) as HTMLDivElement | undefined;
    expect(grid).toBeTruthy();
    expect(grid!.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(grid!.style.gridTemplateRows).toBe('minmax(0, 1fr)');

    const cell = Array.from(grid!.children).find((child) =>
      child.classList.contains('viewport-cell--active'),
    ) as HTMLDivElement | undefined;
    expect(cell).toBeTruthy();
    const csElement = cell!.querySelector<HTMLDivElement>('.cornerstone-element');
    expect(csElement).toBeTruthy();

    // 旧塌陷结构回归哨兵：wrap 的直接子级里不得再出现 viewport-cell
    for (const child of Array.from(wrap!.children)) {
      expect(child.classList.contains('viewport-cell')).toBe(false);
    }
  });

  it('挂载时创建 ResizeObserver 并观察 cornerstone-element；卸载时断开', async () => {
    const { unmount } = await renderReady();
    expect(ResizeObserverMock.instances).toHaveLength(1);
    const observer = ResizeObserverMock.instances[0]!;
    expect(observer.observe).toHaveBeenCalledTimes(1);
    const observed = observer.observe.mock.calls[0]?.[0] as Element | undefined;
    expect(observed?.classList.contains('cornerstone-element')).toBe(true);

    expect(observer.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('容器尺寸变化触发 engine.resize(true, true)（immediate + keepCamera）', async () => {
    await renderReady();
    ResizeObserverMock.instances[0]!.trigger();
    expect(rafCallbacks).toHaveLength(1);
    flushRaf();
    expect(engine.resize).toHaveBeenCalledTimes(1);
    expect(engine.resize).toHaveBeenCalledWith(true, true);

    // resize 抛错（引擎销毁竞态）静默吞掉，不影响下一轮调度
    engine.resize.mockImplementationOnce(() => {
      throw new Error('engine destroyed');
    });
    ResizeObserverMock.instances[0]!.trigger();
    flushRaf();
    expect(engine.resize).toHaveBeenCalledTimes(2);
    expect(rafCallbacks).toHaveLength(0);
  });

  it('rAF 防抖：连续多次尺寸回调合并为一次 resize，下一帧后可再次调度', async () => {
    await renderReady();
    const observer = ResizeObserverMock.instances[0]!;
    observer.trigger();
    observer.trigger();
    observer.trigger();
    expect(rafCallbacks).toHaveLength(1);
    flushRaf();
    expect(engine.resize).toHaveBeenCalledTimes(1);
    // 消费后回到待命态：新回调再次入队（持续响应布局变化）
    observer.trigger();
    expect(rafCallbacks).toHaveLength(1);
  });

  it('引擎未就绪（初始化前触发 RO 回调）时不抛错且不调用 resize', async () => {
    render(
      <Volume3dViewport
        stack={makeStack(2)}
        seriesUid="1.2.s"
        showInfo={false}
        onExitVolume3d={vi.fn()}
        volumeDeps={makeVolumeDeps()}
        webgl2
      />,
    );
    // init 是异步的：此刻 RO 已挂上但 engineRef 仍为 null
    expect(ResizeObserverMock.instances.length).toBeGreaterThan(0);
    expect(() => {
      for (const instance of ResizeObserverMock.instances) {
        instance.trigger();
      }
      flushRaf();
    }).not.toThrow();
    expect(engine.resize).not.toHaveBeenCalled();
  });
});