/**
 * M2-B 非 DICOM 识别与坏文件容错测试（FR-1.4 / FR-1.5）：
 * 扩展名预筛、失败分类（not-dicom / parse-error）、单文件失败不中断整批。
 */
import { describe, expect, it, vi } from 'vitest';
import { isLikelyDicomFileName } from '../src/features/loading/dicomFileFilter';
import { openDicomFiles } from '../src/features/loading/openDicomFiles';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

// 解析管线初始化（cornerstone 动态导入）与本组纯解析断言无关，mock 掉
vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

describe('isLikelyDicomFileName（扩展名预筛）', () => {
  it('.dcm/.dicom 与无扩展名一律尝试解析', () => {
    expect(isLikelyDicomFileName('a.dcm')).toBe(true);
    expect(isLikelyDicomFileName('B.DICOM')).toBe(true);
    expect(isLikelyDicomFileName('noext-1')).toBe(true);
    expect(isLikelyDicomFileName('IM-0001')).toBe(true);
  });

  it('大小写不敏感命中常见非 DICOM 黑名单则排除', () => {
    expect(isLikelyDicomFileName('photo.JPG')).toBe(false);
    expect(isLikelyDicomFileName('notes.txt')).toBe(false);
    expect(isLikelyDicomFileName('report.PDF')).toBe(false);
    expect(isLikelyDicomFileName('clip.MP4')).toBe(false);
    expect(isLikelyDicomFileName('data.JSON')).toBe(false);
  });

  it('未知扩展名（如 Siemens .ima）与隐藏文件放行', () => {
    expect(isLikelyDicomFileName('slice.ima')).toBe(true);
    expect(isLikelyDicomFileName('series.MR')).toBe(true);
    expect(isLikelyDicomFileName('.DS_Store')).toBe(true);
  });
});

describe('openDicomFiles（非 DICOM 跳过 + 坏文件容错）', () => {
  function makeDcmFile(name: string, options?: Parameters<typeof buildSyntheticDicom>[0]): File {
    return new File([buildSyntheticDicom(options)], name);
  }

  it('文本/截断/黑名单扩展名混入：跳过并分类记录，好文件全部保留', async () => {
    const files: File[] = [
      makeDcmFile('good-1.dcm'),
      new File([new TextEncoder().encode('plain text, definitely not dicom')], 'readme'),
      // 通过 DICM 魔数检查但内容截断 → parse-error
      new File([buildSyntheticDicom().slice(0, 200)], 'truncated.dcm'),
      // 内容其实是合法 DICOM，但扩展名在黑名单 → 不读取直接跳过
      makeDcmFile('misnamed.jpg'),
      makeDcmFile('good-2.dcm', { seriesInstanceUid: '1.2.9.2' }),
    ];
    const { opened, failures } = await openDicomFiles(files);

    expect(opened.map((f) => f.fileName)).toEqual(['good-1.dcm', 'good-2.dcm']);

    expect(failures).toHaveLength(3);
    const byName = new Map(failures.map((f) => [f.fileName, f]));
    expect(byName.get('readme')?.kind).toBe('not-dicom');
    expect(byName.get('truncated.dcm')?.kind).toBe('parse-error');
    expect(byName.get('misnamed.jpg')?.kind).toBe('not-dicom');
    expect(byName.get('misnamed.jpg')?.message).toContain('.jpg');
    expect(byName.get('truncated.dcm')?.message).toContain('解析');
  });

  it('文件夹扫描结果（相对路径）作为展示名记录', async () => {
    const good = new File([buildSyntheticDicom()], 'ok.dcm');
    const bad = new File([new Uint8Array([0, 1, 2])], 'broken.dcm');
    const { failures } = await openDicomFiles([
      { file: bad, relativePath: 'folder/sub/broken.dcm' },
      { file: good, relativePath: 'folder/sub/ok.dcm' },
    ]);
    expect(failures[0]?.fileName).toBe('folder/sub/broken.dcm');
    expect(failures[0]?.kind).toBe('not-dicom'); // 3 字节连魔数都没有 → 非 DICOM
  });

  it('空批次返回空结果', async () => {
    const { opened, failures } = await openDicomFiles([]);
    expect(opened).toEqual([]);
    expect(failures).toEqual([]);
  });
});
