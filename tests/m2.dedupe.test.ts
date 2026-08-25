/**
 * M2-E 文件去重测试（FR-1.11）：SOPInstanceUID 跨批次/批内去重。
 */
import { describe, expect, it } from 'vitest';
import { dedupeBySopUid } from '../src/features/series/dedupe';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

let seq = 0;
function makeOpened(sopInstanceUid: string | undefined, tag?: string): OpenedDicomFile {
  const name = `${tag ?? sopInstanceUid ?? 'noid'}-${seq++}.dcm`;
  return {
    fileName: name,
    fileSizeBytes: 100,
    baseImageId: `dcm-file://${name}`,
    summary: {
      patientName: 'T',
      patientId: undefined,
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: undefined,
      studyDate: undefined,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: '1.2.series',
      seriesNumber: undefined,
      seriesDescription: undefined,
      instanceNumber: undefined,
      sliceLocation: undefined,
      sliceThickness: undefined,
      pixelSpacing: undefined,
      imagePositionPatient: undefined,
      imageOrientationPatient: undefined,
      perFrameImagePositions: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 16,
      columns: 16,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: undefined,
      sopInstanceUid,
      transferSyntaxUid: undefined,
    },
  };
}

describe('dedupeBySopUid（FR-1.11）', () => {
  it('同批次内重复 UID 只保留首个', () => {
    const a = makeOpened('1.2.100');
    const b = makeOpened('1.2.100');
    const c = makeOpened('1.2.101');
    const { kept, duplicateCount, nextUids } = dedupeBySopUid([a, b, c], new Set());
    expect(kept.map((f) => f.summary.sopInstanceUid)).toEqual(['1.2.100', '1.2.101']);
    expect(duplicateCount).toBe(1);
    expect(new Set(nextUids)).toEqual(new Set(['1.2.100', '1.2.101']));
  });

  it('跨批次：UID 已在已知集合中则跳过，nextUids 累积', () => {
    const first = dedupeBySopUid([makeOpened('1.2.old')], new Set());
    const second = dedupeBySopUid(
      [makeOpened('1.2.old'), makeOpened('1.2.new')],
      first.nextUids,
    );
    expect(second.kept.map((f) => f.summary.sopInstanceUid)).toEqual(['1.2.new']);
    expect(second.duplicateCount).toBe(1);
    expect(second.nextUids.has('1.2.new')).toBe(true);
  });

  it('缺失 SOPInstanceUID 的文件不去重、始终保留', () => {
    const a = makeOpened(undefined);
    const b = makeOpened(undefined);
    const { kept, duplicateCount } = dedupeBySopUid([a, b], new Set());
    expect(kept).toHaveLength(2);
    expect(duplicateCount).toBe(0);
  });

  it('不修改传入的已知集合（纯函数）', () => {
    const known = new Set(['1.2.x']);
    dedupeBySopUid([makeOpened('1.2.y')], known);
    expect(known.has('1.2.y')).toBe(false);
  });
});
