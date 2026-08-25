/**
 * M2-G 实例排序完善测试（FR-2.3）：
 * InstanceNumber → SliceLocation → IPP 法向量投影 → 文件名 排序链，
 * 以及增强型多帧逐帧位置排序。
 */
import { describe, expect, it } from 'vitest';
import {
  buildSeriesStacks,
  compareInstances,
  sliceProjection,
} from '../src/features/series/buildStacks';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';
import { extractInstanceSummary, parseDicomArrayBuffer } from '../src/dicom/parseDicom';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

const AXIAL_IOP: [number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0];

function makeSummary(overrides: Partial<DicomInstanceSummary>): DicomInstanceSummary {
  return {
    patientName: 'T',
    patientId: undefined,
    patientSex: undefined,
    patientAge: undefined,
    modality: 'CT',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
    institutionName: undefined,
    seriesInstanceUid: undefined,
    seriesNumber: undefined,
    seriesDescription: undefined,
    instanceNumber: undefined,
    sliceLocation: undefined,
    sliceThickness: undefined,
    pixelSpacing: undefined,
    imagePositionPatient: undefined,
    imageOrientationPatient: AXIAL_IOP,
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
    ...overrides,
  };
}

function makeFile(
  fileName: string,
  summaryOverrides: Partial<DicomInstanceSummary>,
): OpenedDicomFile {
  return {
    fileName,
    fileSizeBytes: 1024,
    baseImageId: `dcm-file://${fileName}`,
    summary: makeSummary(summaryOverrides),
  };
}

describe('sliceProjection', () => {
  it('轴位（默认 IOP）下等于 z 分量', () => {
    expect(sliceProjection(makeSummary({ imagePositionPatient: [10, -20, 7.5] }))).toBe(7.5);
  });

  it('斜行切片：沿 IOP 行列叉积方向投影而非 z 轴', () => {
    // row=[0,1,0], col=[0,0,1] → normal=(1,0,0)，投影 = x 分量
    const iop: [number, number, number, number, number, number] = [0, 1, 0, 0, 0, 1];
    const summary = makeSummary({
      imageOrientationPatient: iop,
      imagePositionPatient: [5, 3, 9],
    });
    expect(sliceProjection(summary)).toBeCloseTo(5, 6);
  });

  it('缺失 IPP 返回 undefined', () => {
    expect(sliceProjection(makeSummary({}))).toBeUndefined();
  });
});

describe('compareInstances 完整排序链', () => {
  it('第一级：InstanceNumber 升序，缺失排最后', () => {
    const a = makeFile('a.dcm', { instanceNumber: 1 });
    const b = makeFile('b.dcm', { instanceNumber: 2 });
    const missing = makeFile('z.dcm', {});
    expect(compareInstances(a, b)).toBeLessThan(0);
    expect(compareInstances(missing, a)).toBeGreaterThan(0);
  });

  it('第二级：双方都有 SliceLocation 时按其升序', () => {
    const a = makeFile('a.dcm', { instanceNumber: 1, sliceLocation: -12.5 });
    const b = makeFile('b.dcm', { instanceNumber: 1, sliceLocation: 4 });
    expect(compareInstances(a, b)).toBeLessThan(0);
  });

  it('第三级：无 SliceLocation 时按 IPP 投影升序（轴位）', () => {
    const a = makeFile('a.dcm', { imagePositionPatient: [0, 0, 30] });
    const b = makeFile('b.dcm', { imagePositionPatient: [0, 0, 10] });
    expect(compareInstances(a, b)).toBeGreaterThan(0);
  });

  it('第三级：斜行切片下投影与 z 序不同时以法向量投影为准', () => {
    // normal=(1,0,0)：A 投影=5、z=-9；B 投影=1、z=0。
    // 正确结果 B 在前；错误的 z 兜底排序会得到 A 在前。
    const iop: [number, number, number, number, number, number] = [0, 1, 0, 0, 0, 1];
    const a = makeFile('a.dcm', {
      imageOrientationPatient: iop,
      imagePositionPatient: [5, 0, -9],
    });
    const b = makeFile('b.dcm', {
      imageOrientationPatient: iop,
      imagePositionPatient: [1, 0, 0],
    });
    expect(compareInstances(a, b)).toBeGreaterThan(0);
  });

  it('投影相等时按文件名稳定收尾', () => {
    const a = makeFile('alpha.dcm', { imagePositionPatient: [0, 0, 5] });
    const b = makeFile('beta.dcm', { imagePositionPatient: [0, 0, 5 + 1e-9] });
    // 差异小于容差视为相等
    expect(compareInstances(a, b)).toBeLessThanOrEqual(0);
  });
});

describe('buildSeriesStacks 排序集成', () => {
  it('乱序输入的实例序列输出为正确层序', () => {
    const uid = '1.2.series';
    const opened = [
      makeFile('c-3.dcm', { seriesInstanceUid: uid, instanceNumber: 3, sliceLocation: 30 }),
      makeFile('a-1.dcm', { seriesInstanceUid: uid, instanceNumber: 1, sliceLocation: 10 }),
      makeFile('d-missing.dcm', { seriesInstanceUid: uid }),
      makeFile('b-2.dcm', { seriesInstanceUid: uid, instanceNumber: 2, sliceLocation: 20 }),
    ];
    const stacks = buildSeriesStacks(opened);
    expect(stacks[0]?.items.map((item) => item.fileName)).toEqual([
      'a-1.dcm',
      'b-2.dcm',
      'c-3.dcm',
      'd-missing.dcm',
    ]);
  });

  it('仅靠 IPP 空间位置即可正确排序（无 InstanceNumber/SliceLocation）', () => {
    const uid = '1.2.spatial';
    const opened = [
      makeFile('m1.dcm', { seriesInstanceUid: uid, imagePositionPatient: [0, 0, 15] }),
      makeFile('m2.dcm', { seriesInstanceUid: uid, imagePositionPatient: [0, 0, -5] }),
      makeFile('m3.dcm', { seriesInstanceUid: uid, imagePositionPatient: [0, 0, 40] }),
    ];
    const stacks = buildSeriesStacks(opened);
    expect(stacks[0]?.items.map((item) => item.fileName)).toEqual(['m2.dcm', 'm1.dcm', 'm3.dcm']);
  });
});

describe('增强型多帧逐帧排序（FR-1.8 × FR-2.3）', () => {
  /** 经真实解析管线构造 OpenedDicomFile */
  function parseOpened(fileName: string, buffer: ArrayBuffer): OpenedDicomFile {
    return {
      fileName,
      fileSizeBytes: buffer.byteLength,
      baseImageId: `dcm-file://${fileName}`,
      summary: extractInstanceSummary(parseDicomArrayBuffer(buffer)),
    };
  }

  it('Per-frame 位置乱序写入时，帧按空间位置重排且 frame↔imageId 对应正确', () => {
    // 帧序 z=[7,3,9]，期望显示顺序 z=3(frame2) → z=7(frame1) → z=9(frame3)
    const buffer = buildSyntheticDicom({
      numberOfFrames: 3,
      perFramePlanePositions: [
        [0, 0, 7],
        [0, 0, 3],
        [0, 0, 9],
      ],
    });
    const file = parseOpened('enhanced.dcm', buffer);
    const stacks = buildSeriesStacks([file]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.items.map((item) => item.imageId)).toEqual([
      'dcm-file://enhanced.dcm?frame=2',
      'dcm-file://enhanced.dcm?frame=1',
      'dcm-file://enhanced.dcm?frame=3',
    ]);
    expect(stacks[0]?.items.map((item) => item.frameNumber)).toEqual([2, 1, 3]);
  });

  it('逐帧信息缺失时不重排（保持自然帧序），报告中注明限制', () => {
    const file: OpenedDicomFile = {
      fileName: 'partial.dcm',
      fileSizeBytes: 100,
      baseImageId: 'dcm-file://partial',
      summary: makeSummary({
        numberOfFrames: 3,
        perFrameImagePositions: [
          [0, 0, 3],
          [0, 0, 1],
          undefined as unknown as [number, number, number],
        ],
      }),
    };
    const stacks = buildSeriesStacks([file]);
    expect(stacks[0]?.items.map((item) => item.frameNumber)).toEqual([1, 2, 3]);
  });
});
