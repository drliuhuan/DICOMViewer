/**
 * MPR 体数据组装（FR-6.8，M10-B）。
 *
 * 从既有 `dcm-file://` imageIds（含多帧 `?frame=N`）共享构建同一 volume：
 * - `registerVolumeLoader('cornerstoneStreamingImageVolume', ...
 *   cornerstoneStreamingImageVolumeLoader)`（幂等，防止重复注册）；
 * - 建 volume 前对全部 imageId 预热 NATURALIZED 元数据
 *   （`ensureDcmFileMetadata`，见 FR 审计 §5.1 第 2 点：volume loader 排序/
 *   几何推导会查询 IMAGE_PLANE，须先挂载元数据）；
 * - 增强型多帧逐帧 IPP provider：对 `?frame=N` 的 imageId 用
 *   perFrameImagePositions 覆盖 IMAGE_PLANE.imagePositionPatient，
 *   保证 volume z 排序按逐帧位置（FR 审计 §5.1 第 3 点）。
 *
 * 模块故意把核心正交依赖（ensureMetadata / registerVolumeLoader /
 * createVolume / installFrameIpp）拆成可注入接口，便于单测做调用链断言；
 * 浏览器运行时经 createRealMprVolumeDeps() 装配真实实现。
 * 本模块顶层不 import @cornerstonejs/core（避免 Node 环境加载 vtk），
 * 真实实现全部延迟动态 import。
 */
import { baseImageIdOf, ensureDcmFileMetadata } from '../../dicom/imageId';
import type { SeriesStack } from '../series/buildStacks';

/** StreamingImageVolume loader 的注册 scheme（core 内置 loader 常量名） */
export const MPR_VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';

/** MPR 共享 volume 的 id 前缀（完整 id：`mpr-volume:<seriesUid>`） */
export const MPR_VOLUME_ID_PREFIX = 'mpr-volume';

/** 逐帧 IPP provider 优先级：须高于默认 NATURALIZED 桥接（0） */
export const FRAME_IPP_PROVIDER_PRIORITY = 10;

/** 由序列 UID 生成稳定 volume id（同一序列复用缓存 volume） */
export function volumeIdForSeries(seriesUid: string): string {
  return `${MPR_VOLUME_ID_PREFIX}:${seriesUid}`;
}

/** 收集 volume 所需的全部 imageId（含多帧逐帧变体） */
export function collectVolumeImageIds(stack: SeriesStack): readonly string[] {
  return stack.items.map((item) => item.imageId);
}

export interface FrameIppProviderDeps {
  /** IMAGE_PLANE 模块类型名（Enums.MetadataModules.IMAGE_PLANE） */
  imagePlaneType: string;
  /** 读取 base imageId 的实例级 imagePlaneModule */
  getPlaneModule(imageId: string): unknown;
}

export type FrameIppProvider = (type: string, queries: string) => unknown;

/**
 * 构造逐帧 IPP provider：仅对「增强型多帧」且带逐帧位置的 frame imageId
 * 生效，其余情况返回 undefined（落到默认桥接）。返回模块从实例模块派生，
 * 仅覆写 imagePositionPatient，保持其余字段（IOP/间距等）一致。
 */
export function buildFrameIppProvider(
  stack: SeriesStack,
  deps: FrameIppProviderDeps,
): FrameIppProvider {
  const framePositions = new Map<string, [number, number, number]>();
  for (const item of stack.items) {
    const perFrame = item.summary.perFrameImagePositions;
    if (perFrame === undefined || perFrame.length !== item.summary.numberOfFrames) {
      continue;
    }
    const position = perFrame[item.frameNumber - 1];
    if (position === undefined) {
      continue;
    }
    framePositions.set(item.imageId, position);
  }

  return (type: string, imageId: string): unknown => {
    if (type !== deps.imagePlaneType) {
      return undefined;
    }
    const position = framePositions.get(imageId);
    if (position === undefined) {
      return undefined;
    }
    const baseModule = deps.getPlaneModule(baseImageIdOf(imageId));
    if (typeof baseModule !== 'object' || baseModule === null) {
      return undefined;
    }
    return {
      ...(baseModule as Record<string, unknown>),
      imagePositionPatient: position,
    };
  };
}

export interface FrameIppInstallerDeps extends FrameIppProviderDeps {
  addProvider(provider: FrameIppProvider, priority?: number): void;
  removeProvider(provider: FrameIppProvider): void;
}

/**
 * 注册逐帧 IPP provider 并返回卸载清理函数。
 * 仅在 stack 中存在增强型多帧且带逐帧位置时才有实际覆盖效果。
 */
export function installFrameIppProvider(
  stack: SeriesStack,
  deps: FrameIppInstallerDeps,
): () => void {
  const provider = buildFrameIppProvider(stack, deps);
  deps.addProvider(provider, FRAME_IPP_PROVIDER_PRIORITY);
  return () => deps.removeProvider(provider);
}

export interface StreamingVolumeLoaderApi {
  volumeLoader: {
    registerVolumeLoader(scheme: string, loader: unknown): void;
  };
  streamingImageVolumeLoader: unknown;
}

let streamingLoaderRegistered = false;

/** 幂等注册 cornerstoneStreamingImageVolume loader；无 api 时动态 import core */
export async function ensureStreamingVolumeLoaderRegistered(
  api?: StreamingVolumeLoaderApi,
): Promise<void> {
  if (streamingLoaderRegistered) {
    return;
  }
  streamingLoaderRegistered = true;
  if (api) {
    api.volumeLoader.registerVolumeLoader(
      MPR_VOLUME_LOADER_SCHEME,
      api.streamingImageVolumeLoader,
    );
    return;
  }
  const core = await import('@cornerstonejs/core');
  core.volumeLoader.registerVolumeLoader(
    MPR_VOLUME_LOADER_SCHEME,
    core.cornerstoneStreamingImageVolumeLoader as never,
  );
}

/** 重置 loader 注册标记（测试隔离 / 显式重初始化用） */
export function resetStreamingVolumeLoaderRegistration(): void {
  streamingLoaderRegistered = false;
}

/** buildMprVolume 的可注入依赖（单测注入桩对象断言调用链） */
export interface MprVolumeBuildDeps {
  /** 确保一个 imageId 的 NATURALIZED 元数据已挂载 */
  ensureMetadata(imageId: string): Promise<void>;
  /** 确保 StreamingVolume loader 已注册（幂等） */
  registerVolumeLoader(): Promise<void>;
  /** volumeLoader.createAndCacheVolume(volumeId, { imageIds }) */
  createVolume(
    volumeId: string,
    options: { imageIds: string[] },
  ): Promise<unknown>;
  /** 注册逐帧 IPP provider，返回清理函数 */
  installFrameIpp(stack: SeriesStack): Promise<() => void>;
  imageIdsOf(stack: SeriesStack): readonly string[];
}

export interface BuiltMprVolume {
  volumeId: string;
  imageIds: readonly string[];
  volume: unknown;
  /** 卸载 provider 的清理函数（退出 MPR 时调用） */
  removeFrameIpp: () => void;
}

/**
 * 组装 MPR 共享 volume：order = 注册逐帧 provider → 预热元数据 →
 * 注册 loader → createAndCacheVolume。任一步失败即回滚 provider 并抛错。
 */
export async function buildMprVolume(
  volumeId: string,
  stack: SeriesStack,
  deps: MprVolumeBuildDeps,
): Promise<BuiltMprVolume> {
  const imageIds = [...deps.imageIdsOf(stack)];
  const removeFrameIpp = await deps.installFrameIpp(stack);
  try {
    await Promise.all(imageIds.map((imageId) => deps.ensureMetadata(imageId)));
    await deps.registerVolumeLoader();
    const volume = await deps.createVolume(volumeId, { imageIds });
    return { volumeId, imageIds, volume, removeFrameIpp };
  } catch (error) {
    removeFrameIpp();
    throw error;
  }
}

/**
 * 浏览器运行时的真实依赖装配：全部延迟动态 import @cornerstonejs/core，
 * 避免模块顶层依赖（Node 单测安全）。
 *
 * M11 关键修复：createAndCacheVolume 只完成体数据分配与元数据挂载，
 * 体素（像素）须显式 await volume.load() 才会从 imageIds 流式载入——
 * 此前缺这一步，volume 标量数据全零，直接导致「MPR 三平面黑屏 /
 * 3D 结构缺失」（用户实测报告，M11 任务 1/任务 2 同源根因之一）。
 */
export function createRealMprVolumeDeps(): MprVolumeBuildDeps {
  return {
    ensureMetadata: ensureDcmFileMetadata,
    registerVolumeLoader: () => ensureStreamingVolumeLoaderRegistered(),
    createVolume: async (volumeId, options) => {
      const core = await import('@cornerstonejs/core');
      const volume = await core.volumeLoader.createAndCacheVolume(
        volumeId,
        options as never,
      );
      // 流式加载全部体素；volume 缺失或无 load（测试桩/降级环境）时保持旧行为
      const load = volume
        ? (volume as unknown as { load?: () => Promise<void> }).load
        : undefined;
      if (typeof load === 'function') {
        await load.call(volume);
      }
      return volume;
    },
    installFrameIpp: async (stack) => {
      const core = await import('@cornerstonejs/core');
      return installFrameIppProvider(stack, {
        imagePlaneType: core.Enums.MetadataModules.IMAGE_PLANE,
        getPlaneModule: (imageId) =>
          core.metaData.get(core.Enums.MetadataModules.IMAGE_PLANE, imageId),
        addProvider: core.metaData.addProvider as (
          provider: FrameIppProvider,
          priority?: number,
        ) => void,
        removeProvider: core.metaData.removeProvider as (
          provider: FrameIppProvider,
        ) => void,
      });
    },
    imageIdsOf: collectVolumeImageIds,
  };
}