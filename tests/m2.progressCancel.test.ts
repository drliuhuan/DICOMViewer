/**
 * M2-C 解析进度与取消测试（FR-1.6）：
 * 逐文件进度回调、分批 yield 让出主线程、取消后保留已完成文件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDicomFiles, type OpenedDicomFile } from '../src/features/loading/openDicomFiles';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

/** 构造可控制解析时机的伪 File（openOne 只依赖 name/size/arrayBuffer） */
function makeFakeFile(
  name: string,
  buffer: ArrayBuffer = buildSyntheticDicom(),
  gate?: { promise: Promise<void> },
): File {
  return {
    name,
    size: buffer.byteLength,
    arrayBuffer: async () => {
      if (gate) {
        await gate.promise;
      }
      return buffer;
    },
  } as unknown as File;
}

describe('openDicomFiles 进度回调（FR-1.6）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('每完成一个文件上报 done/total，全部成功', async () => {
    const files = Array.from({ length: 5 }, (_, i) => makeFakeFile(`f${i}.dcm`));
    const progress: Array<[number, number]> = [];
    const result = await openDicomFiles(files, {
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(result.opened).toHaveLength(5);
    expect(result.cancelled).toBe(false);
  });

  it('失败文件同样计入进度', async () => {
    const files: File[] = [
      makeFakeFile('good.dcm'),
      makeFakeFile('bad.dcm', new TextEncoder().encode('not dicom at all').buffer as ArrayBuffer),
      makeFakeFile('good2.dcm'),
    ];
    const progress: number[] = [];
    const result = await openDicomFiles(files, {
      onProgress: (done) => progress.push(done),
    });
    expect(progress).toEqual([1, 2, 3]);
    expect(result.opened).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
  });

  it('每 yieldEvery 个文件让出主线程一次，最后一批不额外等待', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const files = Array.from({ length: 6 }, (_, i) => makeFakeFile(`y${i}.dcm`));
    await openDicomFiles(files, { yieldEvery: 2 });
    // 6 个文件、每 2 个一批 → 第 2、4 个文件后 yield；第 6 个是最后一个不 yield
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
  });
});

describe('openDicomFiles 取消（FR-1.6）', () => {
  it('取消后保留已解析完成的文件，丢弃未开始的', async () => {
    const controller = new AbortController();
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const files: File[] = [
      makeFakeFile('done-1.dcm'),
      makeFakeFile('in-flight.dcm', buildSyntheticDicom(), { promise: secondGate }),
      makeFakeFile('never.dcm'),
      makeFakeFile('never-2.dcm'),
    ];

    const task = openDicomFiles(files, { signal: controller.signal });
    // 等第一个文件完成（微任务排空）
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();
    releaseSecond();

    const result = await task;
    expect(result.cancelled).toBe(true);
    expect(result.opened.map((f: OpenedDicomFile) => f.fileName)).toEqual(['done-1.dcm']);
    expect(result.failures).toEqual([]);
  });

  it('启动前已 abort：立即返回空结果且 cancelled=true', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await openDicomFiles([makeFakeFile('a.dcm')], {
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.opened).toEqual([]);
  });

  it('未取消时不置 cancelled 标志', async () => {
    const controller = new AbortController();
    const result = await openDicomFiles([makeFakeFile('solo.dcm')], {
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(false);
    expect(result.opened).toHaveLength(1);
  });
});
