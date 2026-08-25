/**
 * M2-I 数据集关闭与资源释放测试（FR-2.9）：
 * imageId 注册表 delete、cornerstone cache 清理调用（注入桩）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  baseImageIdOf,
  clearDcmFileRegistry,
  createDcmFileImageId,
  getBufferForImageId,
  releaseDcmFileKey,
  withFrameNumber,
} from '../src/dicom/imageId';
import {
  releaseAll,
  releaseSeries,
  type CacheReleaseApi,
} from '../src/features/series/release';
import type { SeriesStack } from '../src/features/series/buildStacks';
import { clearThumbnails, setThumbnail, thumbnailCount } from '../src/features/series/thumbnails';

function makeBuffer(): ArrayBuffer {
  return new Uint8Array([1, 2, 3, 4]).buffer;
}

function makeStack(
  entries: Array<{ baseId: string; frames?: number }>,
): SeriesStack {
  return {
    seriesUid: '1.2.release',
    modality: 'CT',
    description: undefined,
    patientId: undefined,
    patientName: 'T',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
    items: entries.flatMap(({ baseId, frames = 1 }) =>
      frames > 1
        ? Array.from({ length: frames }, (_, index) => ({
            imageId: withFrameNumber(baseId, index + 1),
            fileName: 'f.dcm',
            frameNumber: index + 1,
            summary: undefined as never,
          }))
        : [
            {
              imageId: baseId,
              fileName: 'f.dcm',
              frameNumber: 1,
              summary: undefined as never,
            },
          ],
    ),
  };
}

function makeCacheStub(): CacheReleaseApi & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    removeImageLoadObject: vi.fn((imageId: string) => {
      removed.push(imageId);
    }),
    purgeCache: vi.fn(),
  };
}

describe('imageId 注册表释放（FR-2.9 约束 #4）', () => {
  it('releaseDcmFileKey 删除缓冲区条目：删除后取用抛错', () => {
    const key = createDcmFileImageId(makeBuffer()).slice('dcm-file://'.length);
    expect(getBufferForImageId(`dcm-file://${key}`)).toBeInstanceOf(ArrayBuffer);
    expect(releaseDcmFileKey(key)).toBe(true);
    expect(() => getBufferForImageId(`dcm-file://${key}`)).toThrow(/不存在/);
    // 幂等：重复删除返回 false
    expect(releaseDcmFileKey(key)).toBe(false);
  });

  it('clearDcmFileRegistry 清空全部条目', () => {
    const idA = createDcmFileImageId(makeBuffer());
    const idB = createDcmFileImageId(makeBuffer());
    clearDcmFileRegistry();
    for (const id of [idA, idB]) {
      expect(() => getBufferForImageId(id)).toThrow(/不存在/);
    }
  });

  it('baseImageIdOf 剥离 ?frame= 查询参数', () => {
    expect(baseImageIdOf('dcm-file://abc?frame=2')).toBe('dcm-file://abc');
    expect(baseImageIdOf('dcm-file://abc')).toBe('dcm-file://abc');
  });
});

describe('releaseSeries / releaseAll（FR-2.9）', () => {
  it('releaseSeries：逐 imageId 调用 removeImageLoadObject 并删除注册表 entry', async () => {
    const single = createDcmFileImageId(makeBuffer());
    const multi = createDcmFileImageId(makeBuffer());
    clearThumbnails();
    const cache = makeCacheStub();
    await releaseSeries(
      makeStack([
        { baseId: single },
        { baseId: multi, frames: 2 },
      ]),
      cache,
    );

    // 多帧展开为 ?frame=1/?frame=2 变体 + 单帧本体
    expect(cache.removed).toEqual([
      single,
      withFrameNumber(multi, 1),
      withFrameNumber(multi, 2),
    ]);
    // 注册表 entry 全部被删除（按 base key）
    expect(() => getBufferForImageId(single)).toThrow(/不存在/);
    expect(() => getBufferForImageId(multi)).toThrow(/不存在/);
  });

  it('releaseAll：逐序列释放后 purgeCache 兜底并清空注册表与缩略图', async () => {
    clearThumbnails();
    setThumbnail('uid-x', 'data:image/png;base64,x');
    const idA = createDcmFileImageId(makeBuffer());
    const idB = createDcmFileImageId(makeBuffer());
    const cache = makeCacheStub();

    await releaseAll(
      [makeStack([{ baseId: idA }]), makeStack([{ baseId: idB }])],
      cache,
    );

    expect(cache.purgeCache).toHaveBeenCalledTimes(1);
    expect(cache.removed).toContain(idA);
    expect(() => getBufferForImageId(idA)).toThrow(/不存在/);
    expect(() => getBufferForImageId(idB)).toThrow(/不存在/);
    expect(thumbnailCount()).toBe(0);
  });

  it('cache 清理抛错不中断释放流程', async () => {
    const id = createDcmFileImageId(makeBuffer());
    const hostile: CacheReleaseApi = {
      removeImageLoadObject: vi.fn(() => {
        throw new Error('not loaded');
      }),
      purgeCache: vi.fn(),
    };
    await releaseSeries(makeStack([{ baseId: id }]), hostile);
    expect(() => getBufferForImageId(id)).toThrow(/不存在/);
  });
});
