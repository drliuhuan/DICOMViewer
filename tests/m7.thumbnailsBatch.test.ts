/**
 * M7 缩略图性能测试（FR-2.4 + NFR-2/NFR-4）：
 * - batchGenerateThumbnails 分批生成、批间让出、缓存跳过、异常隔离；
 * - setThumbnailMaxCount 可配置 LRU 上限（FR-12.5）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THUMBNAIL_MAX_COUNT,
  batchGenerateThumbnails,
  clearThumbnails,
  getThumbnail,
  getThumbnailMaxCount,
  setThumbnail,
  setThumbnailMaxCount,
  thumbnailCount,
} from '../src/features/series/thumbnails';

describe('batchGenerateThumbnails（NFR-2 大序列不阻塞）', () => {
  beforeEach(() => {
    clearThumbnails();
    setThumbnailMaxCount(THUMBNAIL_MAX_COUNT);
  });

  it('为每个序列生成并写入缓存，返回生成条数', async () => {
    const create = vi.fn(
      (item: { seriesUid: string }) => `data:image/png;base64,${item.seriesUid}`,
    );
    const items = [0, 1, 2].map((i) => ({ seriesUid: `uid-${i}`, source: i }));
    const generated = await batchGenerateThumbnails(items, create, {
      yieldTo: async () => undefined,
    });
    expect(generated).toBe(3);
    expect(create).toHaveBeenCalledTimes(3);
    expect(getThumbnail('uid-1')).toBe('data:image/png;base64,uid-1');
  });

  it('分批调用：batchSize=2 处理 5 项 → 3 批、批间让出 2 次', async () => {
    const yieldTo = vi.fn(async () => undefined);
    const items = [0, 1, 2, 3, 4].map((i) => ({ seriesUid: `uid-${i}`, source: i }));
    await batchGenerateThumbnails(
      items,
      () => 'url',
      { batchSize: 2, yieldTo },
    );
    expect(yieldTo).toHaveBeenCalledTimes(2);
    expect(thumbnailCount()).toBe(5);
  });

  it('已命中缓存的序列跳过（create 不再调用）', async () => {
    setThumbnail('uid-0', 'cached');
    const create = vi.fn(() => 'new');
    const generated = await batchGenerateThumbnails(
      [
        { seriesUid: 'uid-0', source: 0 },
        { seriesUid: 'uid-1', source: 1 },
      ],
      create,
      { yieldTo: async () => undefined },
    );
    expect(generated).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(getThumbnail('uid-0')).toBe('cached');
  });

  it('create 抛错隔离：该序列失败不影响其余，onUpdate 只含成功项', async () => {
    const updates: Record<string, string> = {};
    const generated = await batchGenerateThumbnails(
      [
        { seriesUid: 'uid-0', source: 0 },
        { seriesUid: 'uid-1', source: 1 },
      ],
      (item) => {
        if (item.seriesUid === 'uid-0') {
          throw new Error('boom');
        }
        return 'url';
      },
      {
        yieldTo: async () => undefined,
        onUpdate: (u) => Object.assign(updates, u),
      },
    );
    expect(generated).toBe(1);
    expect(Object.keys(updates)).toEqual(['uid-1']);
    expect(getThumbnail('uid-0')).toBeUndefined();
  });

  it('空列表立即返回 0，不触发 onUpdate', async () => {
    const onUpdate = vi.fn();
    const generated = await batchGenerateThumbnails([], () => 'url', { onUpdate });
    expect(generated).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('setThumbnailMaxCount（FR-12.5 可配置 LRU 上限）', () => {
  beforeEach(() => {
    clearThumbnails();
    setThumbnailMaxCount(THUMBNAIL_MAX_COUNT);
  });

  it('默认上限 100', () => {
    expect(getThumbnailMaxCount()).toBe(THUMBNAIL_MAX_COUNT);
  });

  it('下调上限立即淘汰最早写入的多余条目', () => {
    for (let i = 0; i < 5; i += 1) {
      setThumbnail(`uid-${i}`, `url-${i}`);
    }
    setThumbnailMaxCount(3);
    expect(thumbnailCount()).toBe(3);
    expect(getThumbnail('uid-0')).toBeUndefined(); // 最早写入被淘汰
    expect(getThumbnail('uid-2')).toBe('url-2');
    expect(getThumbnail('uid-4')).toBe('url-4'); // 最新保留
  });

  it('非法值夹紧：非有限数/过小 → 最小 1；非整数向下取整', () => {
    setThumbnailMaxCount(Number.NaN);
    expect(getThumbnailMaxCount()).toBe(1);
    setThumbnailMaxCount(45.9);
    expect(getThumbnailMaxCount()).toBe(45);
  });

  it('新上限下 setThumbnail 按新上限淘汰', () => {
    setThumbnailMaxCount(2);
    setThumbnail('a', '1');
    setThumbnail('b', '2');
    setThumbnail('c', '3');
    expect(thumbnailCount()).toBe(2);
    expect(getThumbnail('a')).toBeUndefined();
    expect(getThumbnail('c')).toBe('3');
  });
});
