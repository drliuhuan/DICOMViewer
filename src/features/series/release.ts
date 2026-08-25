/**
 * 数据集关闭与资源释放（FR-2.9，M2-I）。
 *
 * 释放一个序列 = 三处清理：
 * 1. cornerstone cache 中该序列全部 imageId（含多帧 ?frame=N 变体）的图像；
 * 2. `dcm-file://` 内存缓冲注册表对应 entry 与元数据登记标记；
 * 3. （仅清空全部）缩略图缓存。
 *
 * cacheApi 可注入：默认动态 import @cornerstonejs/core 的全局 cache，
 * 单测注入桩对象断言清理被调用。imageId 注册表部分通过
 * getBufferForImageId 的可见行为（删除后取用抛错）在单测中锁定。
 */
import {
  baseImageIdOf,
  clearDcmFileRegistry,
  releaseDcmFileKey,
} from '../../dicom/imageId';
import type { SeriesStack } from './buildStacks';
import { clearThumbnails } from './thumbnails';

/** cornerstone cache 的最小释放接口 */
export interface CacheReleaseApi {
  removeImageLoadObject(imageId: string, options?: { force?: boolean }): void;
  purgeCache(): void;
}

async function defaultCacheApi(): Promise<CacheReleaseApi> {
  const { cache } = await import('@cornerstonejs/core');
  return cache as unknown as CacheReleaseApi;
}

/**
 * 关闭单个序列并释放其占用的资源：
 * 逐 imageId 移除 cornerstone 缓存图像 + 删除内存缓冲注册表 entry。
 */
export async function releaseSeries(
  stack: SeriesStack,
  cacheApi?: CacheReleaseApi,
): Promise<void> {
  const api = cacheApi ?? (await defaultCacheApi());
  for (const item of stack.items) {
    try {
      api.removeImageLoadObject(item.imageId);
    } catch {
      // 图像尚未加载过等场景：忽略
    }
    // 多帧 imageId 带 ?frame=N 查询参数，统一剥离后查注册表 key
    const baseId = baseImageIdOf(item.imageId);
    if (baseId.startsWith('dcm-file://')) {
      releaseDcmFileKey(baseId.slice('dcm-file://'.length));
    }
  }
}

/**
 * 清空全部数据集：逐序列释放 + purgeCache 兜底清空 cornerstone 缓存 +
 * 清空 imageId 注册表与缩略图缓存。
 */
export async function releaseAll(
  stacks: readonly SeriesStack[],
  cacheApi?: CacheReleaseApi,
): Promise<void> {
  const api = cacheApi ?? (await defaultCacheApi());
  for (const stack of stacks) {
    await releaseSeries(stack, api);
  }
  try {
    api.purgeCache();
  } catch {
    // 已空等场景：忽略
  }
  clearDcmFileRegistry();
  clearThumbnails();
}
