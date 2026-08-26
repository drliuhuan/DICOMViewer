/**
 * M10-B MPR 体数据组装（FR-6.8）：loader 注册、逐帧 IPP provider、
 * buildMprVolume 调用链（顺序与参数断言）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_IPP_PROVIDER_PRIORITY,
  MPR_VOLUME_ID_PREFIX,
  MPR_VOLUME_LOADER_SCHEME,
  buildFrameIppProvider,
  buildMprVolume,
  collectVolumeImageIds,
  ensureStreamingVolumeLoaderRegistered,
  installFrameIppProvider,
  resetStreamingVolumeLoaderRegistration,
  volumeIdForSeries,
  type FrameIppInstallerDeps,
} from '../src/features/mpr/mprVolume';
import { baseImageIdOf } from '../src/dicom/imageId';
import type { MprVolumeBuildDeps } from '../src/features/mpr/mprVolume';
import type { SeriesStack, StackItem } from '../src/features/series/buildStacks';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';

function makeStack(overrides: {
  items?: StackItem[];
  seriesUid?: string;
} = {}): SeriesStack {
  return {
    seriesUid: overrides.seriesUid ?? '1.2.s',
    modality: 'CT',
    description: undefined,
    items: overrides.items ?? [],
    patientId: undefined,
    patientName: '',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
  };
}

function makeItem(
  frameNumber: number,
  perFrame?: Array<[number, number, number]>,
): StackItem {
  const numberOfFrames = perFrame?.length ?? 1;
  return {
    imageId:
      numberOfFrames > 1
        ? `dcm-file://k${frameNumber}?frame=${frameNumber}`
        : `dcm-file://k${frameNumber}`,
    fileName: `k${frameNumber}.dcm`,
    frameNumber,
    summary: {
      patientName: '',
      patientId: undefined,
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
      instanceNumber: frameNumber,
      sliceLocation: undefined,
      sliceThickness: 2,
      pixelSpacing: [0.5, 0.5],
      imagePositionPatient: undefined,
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      frameOfReferenceUid: '1.2.f',
      perFrameImagePositions: perFrame,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 16,
      columns: 16,
      bitsAllocated: 16,
      numberOfFrames,
      sopClassUid: undefined,
      sopInstanceUid: `sop${frameNumber}`,
      transferSyntaxUid: undefined,
    } as DicomInstanceSummary,
  } as StackItem;
}

describe('volumeIdForSeries / collectVolumeImageIds', () => {
  it('由序列 UID 生成稳定 volume id', () => {
    expect(volumeIdForSeries('1.2.a')).toBe(`${MPR_VOLUME_ID_PREFIX}:1.2.a`);
  });

  it('收集全部 imageId（含多帧 ?frame=N）', () => {
    const stack = makeStack({
      items: [makeItem(1), makeItem(2, [[0, 0, 0], [0, 0, 2]])],
    });
    expect(collectVolumeImageIds(stack)).toEqual([
      'dcm-file://k1',
      'dcm-file://k2?frame=2',
    ]);
  });
});

describe('buildFrameIppProvider', () => {
  const imagePlaneType = 'imagePlaneModule';
  const deps = {
    imagePlaneType,
    getPlaneModule: vi.fn((_imageId: string) => ({
      imagePositionPatient: [9, 9, 9],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      pixelSpacing: [0.5, 0.5],
    })),
  };

  beforeEach(() => {
    deps.getPlaneModule.mockClear();
  });

  it('非 IMAGE_PLANE 类型直接放行（undefined）', () => {
    const provider = buildFrameIppProvider(makeStack(), deps);
    expect(provider('generalSeriesModule', 'dcm-file://k1')).toBeUndefined();
  });

  it('单帧（无 ?frame=）不覆盖：落默认桥接', () => {
    const provider = buildFrameIppProvider(
      makeStack({ items: [makeItem(1)] }),
      deps,
    );
    expect(provider('imagePlaneModule', 'dcm-file://k1')).toBeUndefined();
    expect(deps.getPlaneModule).not.toHaveBeenCalled();
  });

  it('多帧但无逐帧位置：不覆盖', () => {
    const item = makeItem(2);
    item.summary.numberOfFrames = 2; // 声明多帧但 perFrame 缺
    const provider = buildFrameIppProvider(
      makeStack({ items: [item] }),
      deps,
    );
    expect(provider('imagePlaneModule', 'dcm-file://k2?frame=2')).toBeUndefined();
  });

  it('增强多帧：对 ?frame=N 覆写 imagePositionPatient，其余字段保留', () => {
    const frames: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 4],
    ];
    const provider = buildFrameIppProvider(
      makeStack({
        items: [makeItem(1, frames), makeItem(2, frames)],
      }),
      deps,
    );
    const module = provider('imagePlaneModule', 'dcm-file://k2?frame=2');
    expect(module).toMatchObject({
      imagePositionPatient: [0, 0, 4],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    });
    // base 查询按剥离 frame 的 imageId
    expect(deps.getPlaneModule).toHaveBeenCalledWith('dcm-file://k2');
  });

  it('base 模块缺失时返回 undefined（不抛）', () => {
    const frames: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 4],
    ];
    deps.getPlaneModule.mockReturnValue(undefined as never);
    const provider = buildFrameIppProvider(
      makeStack({
        items: [makeItem(1, frames), makeItem(2, frames)],
      }),
      deps,
    );
    expect(provider('imagePlaneModule', 'dcm-file://k2?frame=2')).toBeUndefined();
  });

  it('baseImageIdOf 剥离查询串的语义与 provider 一致', () => {
    expect(baseImageIdOf('dcm-file://k2?frame=2')).toBe('dcm-file://k2');
    expect(baseImageIdOf('dcm-file://k1')).toBe('dcm-file://k1');
  });
});

describe('installFrameIppProvider', () => {
  it('注册 provider（优先级高于默认）并返回清理函数', () => {
    const addProvider = vi.fn();
    const removeProvider = vi.fn();
    const deps: FrameIppInstallerDeps = {
      imagePlaneType: 'imagePlaneModule',
      getPlaneModule: () => undefined,
      addProvider,
      removeProvider,
    };
    const cleanup = installFrameIppProvider(makeStack({ items: [makeItem(1)] }), deps);
    expect(addProvider).toHaveBeenCalledTimes(1);
    expect(addProvider.mock.calls[0]?.[1]).toBe(FRAME_IPP_PROVIDER_PRIORITY);
    cleanup();
    expect(removeProvider).toHaveBeenCalledTimes(1);
  });
});

describe('ensureStreamingVolumeLoaderRegistered', () => {
  beforeEach(() => {
    resetStreamingVolumeLoaderRegistration();
  });

  it('以传入 api 注册 cornerstoneStreamingImageVolume loader（幂等）', async () => {
    const registerVolumeLoader = vi.fn();
    const loader = { fakeLoader: true };
    await ensureStreamingVolumeLoaderRegistered({
      volumeLoader: { registerVolumeLoader },
      streamingImageVolumeLoader: loader,
    });
    expect(registerVolumeLoader).toHaveBeenCalledTimes(1);
    expect(registerVolumeLoader).toHaveBeenCalledWith(
      MPR_VOLUME_LOADER_SCHEME,
      loader,
    );
    // 再次调用不再重复注册
    await ensureStreamingVolumeLoaderRegistered({
      volumeLoader: { registerVolumeLoader },
      streamingImageVolumeLoader: loader,
    });
    expect(registerVolumeLoader).toHaveBeenCalledTimes(1);
  });
});

describe('buildMprVolume 调用链', () => {
  function makeDeps(overrides: Partial<MprVolumeBuildDeps> = {}): MprVolumeBuildDeps {
    return {
      ensureMetadata: vi.fn(async () => undefined),
      registerVolumeLoader: vi.fn(async () => undefined),
      createVolume: vi.fn(async () => ({ fakeVolume: true })),
      installFrameIpp: vi.fn(async () => vi.fn()),
      imageIdsOf: (stack) => [...stack.items.map((i) => i.imageId)],
      ...overrides,
    };
  }

  it('顺序与参数：先装逐帧 provider、预热全部元数据、注册 loader、createVolume', async () => {
    const order: string[] = [];
    const stack = makeStack({
      items: [makeItem(1), makeItem(2, [[0, 0, 0], [0, 0, 2]])],
    });
    const deps = makeDeps({
      ensureMetadata: vi.fn(async (imageId: string) => {
        order.push(`ensure:${imageId}`);
      }),
      registerVolumeLoader: vi.fn(async () => {
        order.push('registerLoader');
      }),
      createVolume: vi.fn(async (volumeId: string, options: { imageIds: string[] }) => {
        order.push(`create:${options.imageIds.length}`);
        return { volumeId, imageIds: options.imageIds };
      }),
      installFrameIpp: vi.fn(async () => {
        order.push('installFrameIpp');
        return vi.fn();
      }),
    });

    const built = await buildMprVolume('mpr-volume:1.2.s', stack, deps);

    expect(deps.installFrameIpp).toHaveBeenCalledWith(stack);
    expect(deps.ensureMetadata).toHaveBeenCalledWith('dcm-file://k1');
    expect(deps.ensureMetadata).toHaveBeenCalledWith('dcm-file://k2?frame=2');
    expect(deps.registerVolumeLoader).toHaveBeenCalledTimes(1);
    expect(deps.createVolume).toHaveBeenCalledWith('mpr-volume:1.2.s', {
      imageIds: ['dcm-file://k1', 'dcm-file://k2?frame=2'],
    });
    expect(built.volumeId).toBe('mpr-volume:1.2.s');
    expect(built.imageIds).toEqual(['dcm-file://k1', 'dcm-file://k2?frame=2']);

    // 顺序：installFrameIpp → 元数据预热 → loader 注册 → createVolume
    expect(order).toEqual([
      'installFrameIpp',
      'ensure:dcm-file://k1',
      'ensure:dcm-file://k2?frame=2',
      'registerLoader',
      'create:2',
    ]);
  });

  it('createVolume 失败：回滚 provider 并向上抛错', async () => {
    const removeFrameIpp = vi.fn();
    const deps = makeDeps({
      createVolume: vi.fn(async () => {
        throw new Error('volume failed');
      }),
      installFrameIpp: vi.fn(async () => removeFrameIpp),
    });
    await expect(
      buildMprVolume('mpr-volume:1.2.s', makeStack({ items: [makeItem(1)] }), deps),
    ).rejects.toThrow('volume failed');
    expect(removeFrameIpp).toHaveBeenCalledTimes(1);
  });

  it('成功时返回 removeFrameIpp 供调用方退出时清理', async () => {
    const removeFrameIpp = vi.fn();
    const deps = makeDeps({
      installFrameIpp: vi.fn(async () => removeFrameIpp),
    });
    const built = await buildMprVolume('mpr-volume:1.2.s', makeStack({ items: [makeItem(1)] }), deps);
    built.removeFrameIpp();
    expect(removeFrameIpp).toHaveBeenCalledTimes(1);
  });
});