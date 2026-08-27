/**
 * M11 任务 1：volume 构建必须流式加载体素（createRealMprVolumeDeps）。
 * 回归根因：此前 createAndCacheVolume 后未 await volume.load()，
 * 体素全零 → MPR 三平面黑屏 / 3D 结构缺失。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { createAndCacheVolumeMock } = vi.hoisted(() => ({
  createAndCacheVolumeMock: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: { MetadataModules: { IMAGE_PLANE: 'imagePlaneModule' } },
  metaData: { addProvider: vi.fn(), removeProvider: vi.fn(), get: vi.fn(() => undefined) },
  volumeLoader: {
    registerVolumeLoader: vi.fn(),
    createAndCacheVolume: createAndCacheVolumeMock,
  },
  cornerstoneStreamingImageVolumeLoader: { streamLoader: true },
}));

import { createRealMprVolumeDeps } from '../src/features/mpr/mprVolume';
import type { SeriesStack } from '../src/features/series/buildStacks';

function makeStack(frames: number): SeriesStack {
  return {
    seriesUid: '1.2.s',
    modality: 'CT',
    description: undefined,
    items: Array.from({ length: frames }, (_, index) => ({
      imageId: `dcm-file://k${index}`,
      fileName: `f${index}.dcm`,
      frameNumber: index + 1,
      summary: {} as SeriesStack['items'][number]['summary'],
    })),
    patientId: undefined,
    patientName: '',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
  };
}

beforeEach(() => {
  createAndCacheVolumeMock.mockReset();
});

describe('createRealMprVolumeDeps.createVolume', () => {
  it('await volume.load() 完成体素装载后才返回（MPR/3D 共用）', async () => {
    const load = vi.fn(async () => undefined);
    createAndCacheVolumeMock.mockResolvedValue({ load });
    const deps = createRealMprVolumeDeps();
    await deps.createVolume('vol-1', { imageIds: ['dcm-file://k0'] });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('load 抛错时向调用方传播（构建失败错误路径）', async () => {
    createAndCacheVolumeMock.mockResolvedValue({
      load: async () => {
        throw new Error('解码失败');
      },
    });
    const deps = createRealMprVolumeDeps();
    await expect(
      deps.createVolume('vol-2', { imageIds: ['dcm-file://k0'] }),
    ).rejects.toThrow('解码失败');
  });

  it('桩对象无 load 方法时保持旧行为不抛错', async () => {
    createAndCacheVolumeMock.mockResolvedValue({});
    const deps = createRealMprVolumeDeps();
    await expect(
      deps.createVolume('vol-3', { imageIds: [] }),
    ).resolves.toBeDefined();
  });

  it('buildMprVolume 调用链：imageIds 来自完整 items（含多帧展开），而非可见窗口', async () => {
    const load = vi.fn(async () => undefined);
    createAndCacheVolumeMock.mockResolvedValue({ load });
    // 元数据预热/逐帧 provider 与体素装载无关，测试桩替换以隔离注册表依赖
    const real = createRealMprVolumeDeps();
    const deps = {
      ...real,
      ensureMetadata: async () => undefined,
      installFrameIpp: async () => () => undefined,
    };
    const built = await buildViaPublicApi(deps, makeStack(4));
    expect(built.imageIds).toHaveLength(4);
    expect(createAndCacheVolumeMock).toHaveBeenCalledWith(
      'vol-x',
      expect.objectContaining({ imageIds: built.imageIds.slice() }),
    );
    expect(load).toHaveBeenCalledOnce();
  });
});

/** 组合真实依赖走一遍 buildMprVolume 公共入口 */
async function buildViaPublicApi(
  deps: ReturnType<typeof createRealMprVolumeDeps>,
  stack: SeriesStack,
) {
  const { buildMprVolume } = await import('../src/features/mpr/mprVolume');
  return buildMprVolume('vol-x', stack, deps);
}
