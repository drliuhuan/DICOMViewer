/**
 * M1 堆栈构建测试：序列分组、FR-2.3 最小排序、多帧展开、单文件包装。
 */
import { describe, expect, it } from 'vitest';
import { buildSeriesStacks, compareInstances } from '../src/features/series/buildStacks';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

function makeFile(overrides: {
  fileName?: string;
  seriesInstanceUid?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  numberOfFrames?: number;
  modality?: string;
}): OpenedDicomFile {
  return {
    fileName: overrides.fileName ?? 'file.dcm',
    fileSizeBytes: 1024,
    baseImageId: `dcm-file://id-${overrides.fileName ?? 'file'}`,
    summary: {
      patientName: 'T',
      patientId: undefined,
      patientSex: undefined,
      patientAge: undefined,
      modality: overrides.modality ?? 'CT',
      studyDate: undefined,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: overrides.seriesInstanceUid,
      seriesNumber: undefined,
      seriesDescription: undefined,
      instanceNumber: overrides.instanceNumber,
      sliceLocation: overrides.sliceLocation,
      sliceThickness: undefined,
      pixelSpacing: undefined,
      imageOrientationPatient: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 16,
      columns: 16,
      bitsAllocated: 16,
      numberOfFrames: overrides.numberOfFrames ?? 1,
      sopClassUid: undefined,
      sopInstanceUid: undefined,
      transferSyntaxUid: undefined,
    },
  };
}

describe('compareInstances（FR-2.3 最小排序）', () => {
  it('优先按 InstanceNumber 升序', () => {
    const a = makeFile({ fileName: 'b.dcm', instanceNumber: 2 });
    const b = makeFile({ fileName: 'a.dcm', instanceNumber: 1 });
    expect(compareInstances(a, b)).toBeGreaterThan(0);
    expect(compareInstances(b, a)).toBeLessThan(0);
  });

  it('InstanceNumber 相同时按 SliceLocation 升序', () => {
    const a = makeFile({ fileName: 'same.dcm', instanceNumber: 5, sliceLocation: -10 });
    const b = makeFile({ fileName: 'same.dcm', instanceNumber: 5, sliceLocation: 3.5 });
    expect(compareInstances(a, b)).toBeLessThan(0);
  });

  it('缺失 InstanceNumber 的文件排在最后且不抛错', () => {
    const withNumber = makeFile({ fileName: 'a.dcm', instanceNumber: 1 });
    const withoutNumber = makeFile({ fileName: 'z.dcm' });
    expect(compareInstances(withoutNumber, withNumber)).toBeGreaterThan(0);
  });
});

describe('buildSeriesStacks', () => {
  it('单文件包装为 1 帧堆栈', () => {
    const stacks = buildSeriesStacks([makeFile({ fileName: 'only.dcm', modality: 'MR' })]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.items).toHaveLength(1);
    expect(stacks[0]?.modality).toBe('MR');
    expect(stacks[0]?.items[0]?.frameNumber).toBe(1);
  });

  it('同 SeriesInstanceUID 分组并按 InstanceNumber 排序；不同 UID 分列', () => {
    const s1 = '1.2.3.1';
    const s2 = '1.2.3.2';
    const opened = [
      makeFile({ fileName: 'c.dcm', seriesInstanceUid: s1, instanceNumber: 3 }),
      makeFile({ fileName: 'other.dcm', seriesInstanceUid: s2, instanceNumber: 9 }),
      makeFile({ fileName: 'a.dcm', seriesInstanceUid: s1, instanceNumber: 1 }),
      makeFile({ fileName: 'b.dcm', seriesInstanceUid: s1, instanceNumber: 2 }),
    ];
    const stacks = buildSeriesStacks(opened);
    expect(stacks).toHaveLength(2);
    const stackS1 = stacks.find((s) => s.seriesUid === s1);
    expect(stackS1?.items.map((i) => i.fileName)).toEqual(['a.dcm', 'b.dcm', 'c.dcm']);
  });

  it('缺失 SeriesInstanceUID 时按文件各自成组，不互相污染', () => {
    const opened = [
      makeFile({ fileName: 'x.dcm' }),
      makeFile({ fileName: 'y.dcm' }),
    ];
    const stacks = buildSeriesStacks(opened);
    expect(stacks).toHaveLength(2);
  });

  it('多帧文件展开为逐帧 imageId（?frame=N，1 起始）', () => {
    const baseId = 'dcm-file://multi';
    const file = { ...makeFile({ fileName: 'mf.dcm', numberOfFrames: 3 }), baseImageId: baseId };
    const stacks = buildSeriesStacks([file]);
    expect(stacks[0]?.items.map((i) => i.imageId)).toEqual([
      `${baseId}?frame=1`,
      `${baseId}?frame=2`,
      `${baseId}?frame=3`,
    ]);
    expect(stacks[0]?.items.every((i) => i.summary.numberOfFrames === 3)).toBe(true);
  });
});
