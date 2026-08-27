/**
 * M11 任务 1：序列完整性评估（assessSeriesCompleteness / resolveRemoteContext）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  assessSeriesCompleteness,
  resolveRemoteContext,
} from '../src/features/series/seriesCompleteness';
import {
  resetSourceBatchesForTest,
  type SourceBatch,
} from '../src/features/series/sourceRegistry';
import { buildSeriesStacks, type SeriesStack } from '../src/features/series/buildStacks';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

function openedFile(
  seriesUid: string,
  index: number,
  extra: Partial<OpenedDicomFile> = {},
): OpenedDicomFile {
  return {
    fileName: `s-${index}.dcm`,
    fileSizeBytes: 128 + index,
    baseImageId: `dcm-file://k-${seriesUid}-${index}`,
    summary: {
      seriesInstanceUid: seriesUid,
      sopInstanceUid: `1.2.sop-${seriesUid}-${index}`,
    } as OpenedDicomFile['summary'],
    ...extra,
  };
}

function stackOf(opened: OpenedDicomFile[]): SeriesStack[] {
  return buildSeriesStacks(opened);
}

beforeEach(() => {
  resetSourceBatchesForTest();
});

describe('assessSeriesCompleteness', () => {
  it('远程序列 → needsCheck（pacs 补拉）并给出中文原因', () => {
    const [stack] = stackOf([
      openedFile('1.2.s', 1, {
        remoteSource: { serverName: '医院 PACS', studyUid: '1.2.study' },
      }),
    ]);
    const info = assessSeriesCompleteness(stack!);
    expect(info.needsCheck).toBe(true);
    expect(info.fillKind).toBe('pacs');
    expect(info.reason).toContain('医院 PACS');
  });

  it('directory 批次被取消 → needsCheck（重扫目录补齐）', () => {
    const batches: SourceBatch[] = [
      {
        id: 'b1',
        kind: 'directory',
        label: 'CT 目录',
        scannedCount: 6,
        completed: false,
        failedNames: [],
        knownSeriesUids: new Set(['1.2.s']),
        openedFileKeys: new Set(['s-1.dcm\u0000129']),
      },
    ];
    resetSourceBatchesForTest(batches);
    const [stack] = stackOf([openedFile('1.2.s', 1)]);
    const info = assessSeriesCompleteness(stack!);
    expect(info.fillKind).toBe('directory');
    expect(info.batchId).toBe('b1');
    expect(info.reason).toContain('取消');
  });

  it('干净完成的 directory 批次 → 视为完整，无需重扫', () => {
    const batches: SourceBatch[] = [
      {
        id: 'b1',
        kind: 'directory',
        label: 'CT 目录',
        scannedCount: 3,
        completed: true,
        failedNames: [],
        knownSeriesUids: new Set(['1.2.s']),
        openedFileKeys: new Set(),
      },
    ];
    resetSourceBatchesForTest(batches);
    const [stack] = stackOf([openedFile('1.2.s', 1)]);
    const info = assessSeriesCompleteness(stack!);
    expect(info.needsCheck).toBe(false);
    expect(info.fillKind).toBe('none');
  });

  it('存在失败文件的 directory 批次 → needsCheck（核对失败线索）', () => {
    const batches: SourceBatch[] = [
      {
        id: 'b1',
        kind: 'directory',
        label: 'CT 目录',
        scannedCount: 5,
        completed: true,
        failedNames: ['broken.dcm'],
        knownSeriesUids: new Set(['1.2.s']),
        openedFileKeys: new Set(),
      },
    ];
    resetSourceBatchesForTest(batches);
    const [stack] = stackOf([openedFile('1.2.s', 1)]);
    const info = assessSeriesCompleteness(stack!);
    expect(info.needsCheck).toBe(true);
    expect(info.reason).toContain('broken.dcm');
  });

  it('仅手动多选文件（file-list/无登记）→ 已打开即全部，无需核对', () => {
    const [stack] = stackOf([openedFile('1.2.s', 1)]);
    const info = assessSeriesCompleteness(stack!);
    expect(info).toEqual({ needsCheck: false, fillKind: 'none' });
  });
});

describe('resolveRemoteContext', () => {
  const servers = [
    {
      id: 'srv-b',
      name: '备用 PACS',
      baseUrl: 'http://b',
      qidoPrefix: '/dicomweb/studies',
      wadoPrefix: '/dicomweb/studies',
      authHeaderName: '',
      authHeaderValue: '',
      timeoutMs: 5000,
      isDefault: true,
    },
    {
      id: 'srv-a',
      name: '医院 PACS',
      baseUrl: 'http://a',
      qidoPrefix: '/dicomweb/studies',
      wadoPrefix: '/dicomweb/studies',
      authHeaderName: '',
      authHeaderValue: '',
      timeoutMs: 5000,
      isDefault: false,
    },
  ];

  it('按 remoteSource.serverName 精确匹配服务器配置', () => {
    const [stack] = stackOf([
      openedFile('1.2.s', 1, {
        remoteSource: { serverName: '医院 PACS', studyUid: '1.2.study' },
      }),
    ]);
    const resolved = resolveRemoteContext(
      assessSeriesCompleteness(stack!),
      stack!,
      servers,
    );
    expect(resolved.remote?.config.id).toBe('srv-a');
    expect(resolved.remote?.studyUid).toBe('1.2.study');
    expect(resolved.remote?.seriesUid).toBe('1.2.s');
    expect(resolved.error).toBeUndefined();
  });

  it('服务器配置缺失时返回明确错误（不再静默）', () => {
    const info = {
      needsCheck: true,
      fillKind: 'pacs' as const,
    };
    const [stack] = stackOf([openedFile('1.2.s', 1)]);
    const resolved = resolveRemoteContext(info, stack!, []);
    expect(resolved.error).toContain('PACS 面板');
  });
});
