/**
 * M10-B MprViewport 组件（FR-6.1/6.2/6.8/6.4）：三视口 enable（轴向/冠状/矢状
 * ORTHOGRAPHIC）、共享 volume 构建、厚度模式应用与卸载释放的调用链断言。
 * 渲染交互 mock 掉（@cornerstonejs/core|tools）。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { engine, viewports } = vi.hoisted(() => {
  function makeViewportStub(id: string) {
    return {
      id,
      setBlendMode: vi.fn(),
      setSlabThickness: vi.fn(),
      render: vi.fn(),
      getZoom: vi.fn(() => 1),
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
    ViewportType: { ORTHOGRAPHIC: 'orthographic', STACK: 'stack' },
    OrientationAxis: { AXIAL: 'axial', CORONAL: 'coronal', SAGITTAL: 'sagittal' },
    Events: {
      VOLUME_NEW_IMAGE: 'CORNERSTONE_VOLUME_NEW_IMAGE',
      VOI_MODIFIED: 'CORNERSTONE_VOI_MODIFIED',
      CAMERA_MODIFIED: 'CORNERSTONE_CAMERA_MODIFIED',
    },
    BlendModes: {
      AVERAGE_INTENSITY_BLEND: 0,
      MAXIMUM_INTENSITY_BLEND: 1,
      MINIMUM_INTENSITY_BLEND: 2,
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
  function fakeToolGroup(id: string) {
    return {
      id,
      addViewport: vi.fn(),
      addTool: vi.fn(),
      setToolActive: vi.fn(),
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
    ToolGroupManager: {
      createToolGroup: vi.fn((id: string) => {
        const group = fakeToolGroup(id);
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

import * as core from '@cornerstonejs/core';
import { MprViewport } from '../src/features/mpr/MprViewport';
import type { MprVolumeBuildDeps } from '../src/features/mpr/mprVolume';
import type { SeriesStack, StackItem } from '../src/features/series/buildStacks';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';

function makeStack(itemCount: number): SeriesStack {
  const items: StackItem[] = [];
  for (let i = 1; i <= itemCount; i++) {
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeVolumeDeps(): MprVolumeBuildDeps {
  return {
    ensureMetadata: vi.fn(async () => undefined),
    registerVolumeLoader: vi.fn(async () => undefined),
    createVolume: vi.fn(async () => ({ volumeId: 'mpr-volume:1.2.s' })),
    installFrameIpp: vi.fn(async () => () => undefined),
    imageIdsOf: (stack) => [...stack.items.map((item) => item.imageId)],
  };
}

describe('MprViewport 挂载/初始化', () => {
  it('启用三个 ORTHOGRAPHIC 视口并设置轴向/冠状/矢状方向', async () => {
    const stack = makeStack(3);
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );

    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(3);
    });
    expect(engine.enableElement.mock.calls.map(([input]) => input.viewportId)).toEqual([
      'mpr-axial',
      'mpr-coronal',
      'mpr-sagittal',
    ]);
    const inputs = engine.enableElement.mock
      .calls as Array<[{ type: string; defaultOptions: { orientation: string } }]>;
    expect(inputs.length).toBe(3);
    expect(inputs[0]?.[0].type).toBe('orthographic');
    expect(inputs[0]?.[0].defaultOptions.orientation).toBe('axial');
    expect(inputs[1]?.[0].defaultOptions.orientation).toBe('coronal');
    expect(inputs[2]?.[0].defaultOptions.orientation).toBe('sagittal');
  });

  it('构建共享 volume：预热元数据 → loader → createAndCacheVolume(volumeId, imageIds)', async () => {
    const stack = makeStack(2);
    const volumeDeps = makeVolumeDeps();
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={volumeDeps}
      />,
    );

    await waitFor(() => {
      expect(volumeDeps.createVolume).toHaveBeenCalledTimes(1);
    });
    expect(volumeDeps.createVolume).toHaveBeenCalledWith('mpr-volume:1.2.s', {
      imageIds: ['dcm-file://k1', 'dcm-file://k2'],
    });
    expect(volumeDeps.ensureMetadata).toHaveBeenCalledWith('dcm-file://k1');
    expect(volumeDeps.ensureMetadata).toHaveBeenCalledWith('dcm-file://k2');
    expect(volumeDeps.registerVolumeLoader).toHaveBeenCalledTimes(1);
    expect(volumeDeps.installFrameIpp).toHaveBeenCalledTimes(1);
  });

  it('volume 装载到三视口（共用同一 volume，不逐视口重建）', async () => {
    const stack = makeStack(2);
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );

    await waitFor(() => {
      expect(core.setVolumesForViewports).toHaveBeenCalledTimes(1);
    });
    expect(core.setVolumesForViewports).toHaveBeenCalledWith(
      engine,
      [{ volumeId: 'mpr-volume:1.2.s' }],
      ['mpr-axial', 'mpr-coronal', 'mpr-sagittal'],
    );
  });

  it('渲染「MPR 三平面」控制栏与三平面角标（轴向/冠状/矢状）', async () => {
    const stack = makeStack(2);
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );
    expect(screen.getByText('MPR 三平面')).toBeTruthy();
    expect(screen.getAllByText(/轴向/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/冠状/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/矢状/).length).toBeGreaterThan(0);
  });

  it('退出按钮触发 onExitMpr', async () => {
    const stack = makeStack(2);
    const onExitMpr = vi.fn();
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={onExitMpr}
        volumeDeps={makeVolumeDeps()}
      />,
    );
    fireEvent.click(screen.getByText('退出 MPR'));
    expect(onExitMpr).toHaveBeenCalledTimes(1);
  });
});

describe('MprViewport 厚度模式（FR-6.4）', () => {
  it('就绪后默认 Average 应用于三视口 setBlendMode/setSlabThickness', async () => {
    const stack = makeStack(2);
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(
        (viewports['mpr-axial'] as unknown as {
          setBlendMode: ReturnType<typeof vi.fn>;
        }).setBlendMode,
      ).toHaveBeenCalled();
    });
    for (const id of ['mpr-axial', 'mpr-coronal', 'mpr-sagittal']) {
      const vp = viewports[id] as {
        setBlendMode: ReturnType<typeof vi.fn>;
        setSlabThickness: ReturnType<typeof vi.fn>;
      };
      expect(vp.setBlendMode).toHaveBeenCalledWith(0); // AVERAGE_INTENSITY_BLEND
      expect(vp.setSlabThickness).toHaveBeenCalledWith(1);
    }
  });

  it('切换 MIP 模式：三视口 blendMode 更新为最大密度投影', async () => {
    const stack = makeStack(2);
    render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(3);
    });
    fireEvent.change(screen.getByLabelText('MPR 重建模式'), {
      target: { value: 'MIP' },
    });
    await waitFor(() => {
      const axial = viewports['mpr-axial'] as { setBlendMode: ReturnType<typeof vi.fn> };
      expect(axial.setBlendMode).toHaveBeenLastCalledWith(1); // MAXIMUM_INTENSITY_BLEND
    });
  });
});

describe('MprViewport 卸载释放（FR-6.9/FR-7.12 同类）', () => {
  it('退出：销毁 ToolGroup、禁用三视口、释放 volume 缓存与逐帧 provider', async () => {
    const stack = makeStack(2);
    const removeVolumeLoadObject = vi.mocked(core.cache.removeVolumeLoadObject);
    const destroyToolGroup = vi.mocked(
      (await import('@cornerstonejs/tools')).ToolGroupManager.destroyToolGroup,
    );
    const { unmount } = render(
      <MprViewport
        stack={stack}
        seriesUid="1.2.s"
        showInfo={false}
        onExitMpr={vi.fn()}
        volumeDeps={makeVolumeDeps()}
      />,
    );
    await waitFor(() => {
      expect(engine.enableElement).toHaveBeenCalledTimes(3);
    });

    unmount();

    await waitFor(() => {
      expect(removeVolumeLoadObject).toHaveBeenCalledWith('mpr-volume:1.2.s');
    });
    expect(destroyToolGroup).toHaveBeenCalledWith('dicom-viewer-m1-engine:mpr');
    expect(engine.disableElement).toHaveBeenCalledTimes(3);
    for (const id of ['mpr-axial', 'mpr-coronal', 'mpr-sagittal']) {
      expect(engine.disableElement).toHaveBeenCalledWith(id);
    }
  });
});