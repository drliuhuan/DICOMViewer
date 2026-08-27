/**
 * M11 任务 1：完整序列补载执行器单测。
 * - fillFromDirectory：目录重扫仅补目标序列、跳过已打开键、失败分类；
 * - fillFromPacs：QIDO 差集逐实例拉取、取消语义、复用 remoteInstances 通道。
 */
import { describe, expect, it, vi } from 'vitest';
import { buildSyntheticDicom } from './helpers/syntheticDicom';
import { fillFromDirectory, fillFromPacs } from '../src/features/series/fillSeries';
import type { DirectoryHandleLike } from '../src/features/loading/directoryScan';

function dicomFile(name: string, seriesUid: string, z: number): { file: File; size: number } {
  const buffer = buildSyntheticDicom({
    seriesInstanceUid: seriesUid,
    imagePositionPatient: [0, 0, z],
    instanceNumber: Math.round(z / 2) + 1,
    pixelSpacing: [0.5, 0.5],
  });
  const file = new File([buffer], name);
  return { file, size: buffer.byteLength };
}

describe('fillFromDirectory（本地目录重扫补齐）', () => {
  function makeDirectory(
    entries: Array<{ file: File }>,
  ): DirectoryHandleLike {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iter = async function* () {
      for (const entry of entries) {
        yield {
          kind: 'file' as const,
          name: entry.file.name,
          getFile: async () => entry.file,
        };
      }
      yield {
        kind: 'directory' as const,
        name: 'nested',
        values: async function* () {
          /* 空目录覆盖递归分支 */
        },
      };
    };
    return {
      kind: 'directory',
      name: 'study',
      values: () => iter() as never,
    };
  }

  it('只把归属目标序列且未打开过的文件注册进注册表', async () => {
    const same1 = dicomFile('s1.dcm', '1.2.s', 0);
    const same2 = dicomFile('sub/s2.dcm', '1.2.s', 2);
    const other = dicomFile('o1.dcm', '1.2.other', 0);
    const junk = { file: new File([new TextEncoder().encode('<html/>')], 'report.txt') };
    const handle = makeDirectory([same1, same2, other, junk]);

    const knownKey = `${same1.file.name}\u0000${same1.size}`;
    const result = await fillFromDirectory({
      directoryHandle: handle,
      targetSeriesUid: '1.2.s',
      openedFileKeys: new Set([knownKey]),
      onProgress: undefined,
    });

    // s1 已打开被跳过；only s2 归属 1.2.s 补入；other 序列不吸收；txt 不计入核对
    expect(result.checkedCount).toBe(2);
    expect(result.added.length).toBe(1);
    expect(result.added[0]?.fileName).toBe('sub/s2.dcm');    expect(result.added[0]?.summary.seriesInstanceUid).toBe('1.2.s');
    expect(result.added[0]?.baseImageId.startsWith('dcm-file://')).toBe(true);
    expect(result.failures.length).toBe(0);
    expect(result.cancelled).toBe(false);
  });

  it('解析失败的坏文件记入 failures（parse-error），不中断整批', async () => {
    const good = dicomFile('g.dcm', '1.2.s', 4);
    // 有 DICM 魔数但内容损坏 → ParseFailureError（构造：preamble+DICM+随机体）
    const corruptBytes = new Uint8Array(256);
    corruptBytes.set([0x44, 0x49, 0x43, 0x4d], 128);
    const corrupt = { file: new File([corruptBytes], 'bad.dcm') };
    const result = await fillFromDirectory({
      directoryHandle: makeDirectory([good, corrupt]),
      targetSeriesUid: '1.2.s',
    });
    expect(result.added.map((item) => item.fileName)).toEqual(['g.dcm']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('parse-error');
  });
});

describe('fillFromPacs（远端按 SeriesUID 补拉缺失实例）', () => {
  const JSON_HEADERS_JSON = [{ '00080018': { Value: ['1.2.sop-2'] } }];
  const ALL_JSON = [
    { '00080018': { Value: ['1.2.sop-1'] } },
    { '00080018': { Value: ['1.2.sop-2'] } },
    { '00080018': { Value: ['1.2.sop-3'] } },
  ];

  function jsonResponse(payload: unknown): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  }

  function bytesResponse(buffer: ArrayBuffer): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => undefined,
      arrayBuffer: async () => buffer,
      text: async () => '',
    } as unknown as Response;
  }

  it('只拉取已知 SOP 集之外的缺失实例，并经 toOpenedFiles 打包', async () => {
    const config = {
      id: 'srv',
      name: '医院 PACS',
      baseUrl: 'http://pacs.local:8080',
      qidoPrefix: '/dicomweb/studies',
      wadoPrefix: '/dicomweb/studies',
      authHeaderName: '',
      authHeaderValue: '',
      timeoutMs: 5000,
      isDefault: true,
    };
    const fetchedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      // QIDO 实例列表 URL：…/series/1.2.s?limit=…；取像素：…/instances/{sop}
      if (url.includes('/series/1.2.s?')) {
        return jsonResponse(ALL_JSON);
      }
      return bytesResponse(buildSyntheticDicom({ seriesInstanceUid: '1.2.s', rows: 8, columns: 8 }));
    });
    const progress: Array<{ done: number; total: number }> = [];
    const result = await fillFromPacs({
      context: {
        serverName: '医院 PACS',
        studyUid: '1.2.study',
        seriesUid: '1.2.s',
        config,
      },
      targetSeriesUid: '1.2.s',
      knownSopUids: new Set(['1.2.sop-1', '1.2.sop-3']),
      fetchImpl,
      onProgress: (entry) => progress.push(entry),
    });
    // sop-2 是唯一缺失实例
    expect(result.failures.length).toBe(0);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.remoteSource).toEqual({
      serverName: '医院 PACS',
      studyUid: '1.2.study',
    });
    expect(result.added[0]?.summary.seriesInstanceUid).toBe('1.2.s');
    expect(result.checkedCount).toBe(3);
    const retrieveCalls = fetchedUrls.filter((url) => url.includes('/instances/'));
    expect(retrieveCalls).toHaveLength(1);
    expect(progress.at(-1)?.done).toBe(1);
  });

  it('取消信号中止后续拉取，返回已完成部分与 cancelled 标记', async () => {
    const config = {
      id: 'srv',
      name: '医院 PACS',
      baseUrl: 'http://pacs.local:8080',
      qidoPrefix: '/dicomweb/studies',
      wadoPrefix: '/dicomweb/studies',
      authHeaderName: '',
      authHeaderValue: '',
      timeoutMs: 5000,
      isDefault: true,
    };
    const controller = new AbortController();
    let count = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/series/1.2.s?')) {
        return jsonResponse(JSON_HEADERS_JSON);
      }
      count += 1;
      if (count === 1) {
        controller.abort();
      }
      return bytesResponse(buildSyntheticDicom({ rows: 8, columns: 8 }));
    });
    const result = await fillFromPacs({
      context: { serverName: 'p', studyUid: '1.2.study', seriesUid: '1.2.s', config },
      targetSeriesUid: '1.2.s',
      fetchImpl,
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.added.length + result.failures.length).toBeLessThanOrEqual(1);
  });
});
