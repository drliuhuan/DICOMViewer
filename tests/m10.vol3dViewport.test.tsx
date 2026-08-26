/**
 * M10-C Volume3dViewport 组件（FR-7.1/7.2/7.3/7.7/7.8/7.9/7.12）：
 * VOLUME_3D 视口 enable、volume 构建与装载、预设下拉/复位视角/截图/
 * 质量档位/窗宽窗位联动、卸载释放 的调用链断言。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools + apply 的 vtk 装配）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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