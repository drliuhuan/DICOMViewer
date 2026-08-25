/**
 * M2-D 多帧增强与元数据层级测试（FR-1.8 / FR-1.10）：
 * Per-frame Functional Groups 逐帧位置提取、StudyInstanceUID 提取、
 * 患者→检查→序列树构建。
 */
import { describe, expect, it } from 'vitest';
import {
  extractInstanceSummary,
  parseDicomArrayBuffer,
} from '../src/dicom/parseDicom';
import { buildSeriesStacks } from '../src/features/series/buildStacks';
import { buildSeriesTree, type PatientNode } from '../src/features/series/seriesTree';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

describe('extractInstanceSummary（FR-1.10 新增字段）', () => {
  it('提取 StudyInstanceUID 与 ImagePositionPatient', () => {
    const buffer = buildSyntheticDicom({
      studyInstanceUid: '1.2.840.999.1',
      imagePositionPatient: [-125.5, 120.25, 30],
    });
    const summary = extractInstanceSummary(parseDicomArrayBuffer(buffer));
    expect(summary.studyInstanceUid).toBe('1.2.840.999.1');
    expect(summary.imagePositionPatient).toEqual([-125.5, 120.25, 30]);
  });

  it('缺失字段时为 undefined 而不抛错', () => {
    const summary = extractInstanceSummary(parseDicomArrayBuffer(buildSyntheticDicom()));
    expect(summary.studyInstanceUid).toBeUndefined();
    expect(summary.imagePositionPatient).toBeUndefined();
    expect(summary.perFrameImagePositions).toBeUndefined();
  });
});

describe('Enhanced 多帧逐帧位置解析（FR-1.8）', () => {
  it('从 Per-frame Functional Groups Sequence 提取逐帧 IPPSynthetic', () => {
    const positions: Array<[number, number, number]> = [
      [-100, -90, 5],
      [-100, -90, 2.5],
      [-100, -90, 0],
    ];
    const buffer = buildSyntheticDicom({
      numberOfFrames: 3,
      perFramePlanePositions: positions,
    });
    const summary = extractInstanceSummary(parseDicomArrayBuffer(buffer));
    expect(summary.numberOfFrames).toBe(3);
    expect(summary.perFrameImagePositions).toEqual(positions);
  });

  it('单帧文件不产出逐帧位置', () => {
    const buffer = buildSyntheticDicom({
      perFramePlanePositions: [[0, 0, 0]],
    });
    const summary = extractInstanceSummary(parseDicomArrayBuffer(buffer));
    expect(summary.perFrameImagePositions).toBeUndefined();
  });

  it('逐帧位置与帧号对齐：乱序写入时按下标对应各帧', () => {
    // 帧序 z=[7,3,9]：下标 i 的位置即第 i+1 帧的位置
    const positions: Array<[number, number, number]> = [
      [0, 0, 7],
      [0, 0, 3],
      [0, 0, 9],
    ];
    const summary = extractInstanceSummary(
      parseDicomArrayBuffer(buildSyntheticDicom({ numberOfFrames: 3, perFramePlanePositions: positions })),
    );
    expect(summary.perFrameImagePositions?.[0]?.[2]).toBe(7);
    expect(summary.perFrameImagePositions?.[1]?.[2]).toBe(3);
    expect(summary.perFrameImagePositions?.[2]?.[2]).toBe(9);
  });
});

function makeStack(overrides: {
  seriesUid?: string;
  patientId?: string;
  patientName?: string;
  studyInstanceUid?: string;
  studyDate?: string;
  modality?: string;
}): OpenedDicomFile {
  return {
    fileName: `${overrides.seriesUid ?? 's'}.dcm`,
    fileSizeBytes: 1024,
    baseImageId: `dcm-file://${overrides.seriesUid ?? 's'}`,
    summary: {
      patientName: overrides.patientName ?? 'T',
      patientId: overrides.patientId,
      patientSex: undefined,
      patientAge: undefined,
      modality: overrides.modality ?? 'CT',
      studyInstanceUid: overrides.studyInstanceUid,
      studyDate: overrides.studyDate,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: overrides.seriesUid,
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
      sopInstanceUid: undefined,
      transferSyntaxUid: undefined,
    },
  };
}

describe('buildSeriesTree（患者→检查→序列，FR-2.1/2.7）', () => {
  it('同一患者的多个检查并列分组；不同患者分列', () => {
    const stacks = buildSeriesStacks([
      makeStack({ seriesUid: '1.2.s1', patientId: 'P001', patientName: '张^三', studyInstanceUid: '1.2.studyA', studyDate: '20260101' }),
      makeStack({ seriesUid: '1.2.s2', patientId: 'P001', patientName: '张^三', studyInstanceUid: '1.2.studyB', studyDate: '20260301' }),
      makeStack({ seriesUid: '1.2.s3', patientId: 'P002', patientName: '李^四', studyInstanceUid: '1.2.studyC', studyDate: '20260201' }),
    ]);
    const tree: PatientNode[] = buildSeriesTree(stacks);
    expect(tree).toHaveLength(2);
    const zhang = tree.find((p) => p.name.includes('张'));
    expect(zhang?.studies).toHaveLength(2);
    // 检查按日期降序：新检查在前
    expect(zhang?.studies.map((s) => s.date)).toEqual(['20260301', '20260101']);
    expect(zhang?.studies[0]?.series[0]?.seriesUid).toBe('1.2.s2');
  });

  it('同一患者同一 UID 的检查聚合为一个节点', () => {
    const stacks = buildSeriesStacks([
      makeStack({ seriesUid: '1.2.a', patientId: 'P1', studyInstanceUid: 'S1' }),
      makeStack({ seriesUid: '1.2.b', patientId: 'P1', studyInstanceUid: 'S1' }),
    ]);
    const tree = buildSeriesTree(stacks);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.studies).toHaveLength(1);
    expect(tree[0]?.studies[0]?.series).toHaveLength(2);
  });

  it('缺失 StudyInstanceUID 时按「日期|描述」回退分组键', () => {
    const stacks = buildSeriesStacks([
      makeStack({ seriesUid: '1.2.x', patientId: 'P1', studyDate: '20260101' }),
      makeStack({ seriesUid: '1.2.y', patientId: 'P1', studyDate: '20260101' }),
      makeStack({ seriesUid: '1.2.z', patientId: 'P1', studyDate: '20250101' }),
    ]);
    const tree = buildSeriesTree(stacks);
    expect(tree[0]?.studies).toHaveLength(2);
  });

  it('患者信息全缺时归入「未知患者」，不互相串组', () => {
    const stacks = buildSeriesStacks([
      makeStack({ seriesUid: '1.2.m', patientName: '(无姓名)' }),
      makeStack({ seriesUid: '1.2.n', patientName: '(无姓名)' }),
    ]);
    const tree = buildSeriesTree(stacks);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe('未知患者');
    expect(tree[0]?.studies[0]?.series).toHaveLength(2);
  });

  it('空列表返回空树', () => {
    expect(buildSeriesTree([])).toEqual([]);
  });
});
