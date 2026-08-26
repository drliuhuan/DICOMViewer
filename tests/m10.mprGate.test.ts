/**
 * M10-B MPR 数据门槛判定（FR-6.7）：层数<2 / 无像素间距 / 无 IPP 禁用并提示；
 * 层间距不一致按 IPP 重采样并提示；增强型多帧按逐帧 IPP 判定。
 */
import { describe, expect, it } from 'vitest';
import {
  checkMprEligibility,
  frameImagePosition,
} from '../src/features/mpr/mprGate';
import type { SeriesStack, StackItem } from '../src/features/series/buildStacks';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';

interface ItemOpts {
  ipp?: [number, number, number];
  perFrame?: Array<[number, number, number]>;
  /** null 表示显式缺省（无像素间距），undefined 使用默认 */
  pixelSpacing?: [number, number] | null;
  numberOfFrames?: number;
}

function makeItem(frameNumber: number, opts: ItemOpts = {}): StackItem {
  const perFrameLength = opts.perFrame?.length ?? 0;
  const numberOfFrames =
    opts.numberOfFrames ?? (perFrameLength > 0 ? perFrameLength : 1);
  const frameSuffix =
    numberOfFrames > 1 ? `?frame=${frameNumber}` : '';
  const summary = {
    patientName: '',
    patientId: undefined,
    patientSex: undefined,
    patientAge: undefined,
    modality: 'CT',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
    institutionName: undefined,
    seriesInstanceUid: '1.2.s',
    seriesNumber: undefined,
    seriesDescription: undefined,
    instanceNumber: frameNumber,
    sliceLocation: undefined,
    sliceThickness: 1.25,
    pixelSpacing:
      opts.pixelSpacing === null ? undefined : (opts.pixelSpacing ?? [0.5, 0.5]),
    imagePositionPatient: opts.ipp,
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    frameOfReferenceUid: '1.2.f',
    perFrameImagePositions: opts.perFrame,
    windowWidth: undefined,
    windowCenter: undefined,
    rows: 16,
    columns: 16,
    bitsAllocated: 16,
    numberOfFrames,
    sopClassUid: undefined,
    sopInstanceUid: `sop${frameNumber}`,
    transferSyntaxUid: undefined,
  } as DicomInstanceSummary;
  return {
    imageId: `dcm-file://key${frameSuffix}`,
    fileName: `k${frameNumber}.dcm`,
    frameNumber,
    summary,
  } as StackItem;
}

function makeStack(items: StackItem[]): SeriesStack {
  return {
    seriesUid: '1.2.s',
    modality: 'CT',
    description: undefined,
    items,
    patientId: undefined,
    patientName: '',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
  };
}

describe('frameImagePosition', () => {
  it('增强型多帧取逐帧位置（数组下标 = 帧号-1）', () => {
    const item = makeItem(3, {
      perFrame: [
        [0, 0, 0],
        [0, 0, 2],
        [0, 0, 4],
      ],
    });
    expect(frameImagePosition(item)).toEqual([0, 0, 4]);
  });

  it('逐帧位置缺失时回退实例级 IPP', () => {
    const item = makeItem(9, { ipp: [1, 2, 3] });
    expect(frameImagePosition(item)).toEqual([1, 2, 3]);
  });

  it('perFrame 长度与帧数不一致时回退实例 IPP', () => {
    const item = makeItem(2, {
      ipp: [5, 5, 5],
      perFrame: [[0, 0, 0]], // 长度 1 ≠ 帧数 2
      numberOfFrames: 2,
    });
    expect(frameImagePosition(item)).toEqual([5, 5, 5]);
  });
});

describe('checkMprEligibility', () => {
  it('无加载序列：禁用并提示先加载', () => {
    const result = checkMprEligibility(null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_SERIES');
    expect(result.message).toContain('加载序列');
  });

  it('层数 < 2：禁用并提示至少 2 层', () => {
    const result = checkMprEligibility(makeStack([makeItem(1, { ipp: [0, 0, 0] })]));
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('TOO_FEW_SLICES');
    expect(result.message).toContain('至少 2 层');
  });

  it('无像素间距：禁用并提示', () => {
    const stack = makeStack([
      makeItem(1, { ipp: [0, 0, 0], pixelSpacing: null }),
      makeItem(2, { ipp: [0, 0, 2] }),
    ]);
    const result = checkMprEligibility(stack);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MISSING_PIXEL_SPACING');
    expect(result.message).toContain('像素间距');
  });

  it('像素间距含零分量：同样禁用', () => {
    const stack = makeStack([
      makeItem(1, { ipp: [0, 0, 0], pixelSpacing: [0, 0.5] }),
      makeItem(2, { ipp: [0, 0, 2] }),
    ]);
    expect(checkMprEligibility(stack).allowed).toBe(false);
  });

  it('任一层缺少 IPP：禁用并提示', () => {
    const stack = makeStack([
      makeItem(1, { ipp: [0, 0, 0] }),
      makeItem(2, { ipp: undefined }),
    ]);
    const result = checkMprEligibility(stack);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MISSING_IPP');
    expect(result.message).toContain('IPP');
  });

  it('增强型多帧某帧缺逐帧位置且实例无 IPP：禁用', () => {
    // 第二条记录显式声明 2 帧，但 perFrame 只给 1 帧 → 长度不匹配 → 回退实例 IPP（undefined）
    const missing = makeStack([
      makeItem(1, { perFrame: [[0, 0, 0], [0, 0, 2]] }),
      makeItem(2, { ipp: undefined, numberOfFrames: 2, perFrame: [[0, 0, 2]] }),
    ]);
    expect(checkMprEligibility(missing).allowed).toBe(false);
    expect(checkMprEligibility(missing).reason).toBe('MISSING_IPP');
  });

  it('增强型多帧逐帧位置完整：即便实例级 IPP 缺失也允许', () => {
    const frames: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 2],
    ];
    const stack = makeStack([
      makeItem(1, { ipp: undefined, perFrame: frames }),
      makeItem(2, { ipp: undefined, perFrame: frames }),
    ]);
    expect(checkMprEligibility(stack).allowed).toBe(true);
  });

  it('合法数据（≥2 层，含间距含 IPP，层距一致）：允许，无不均提示', () => {
    const stack = makeStack([
      makeItem(1, { ipp: [0, 0, 0] }),
      makeItem(2, { ipp: [0, 0, 2] }),
      makeItem(3, { ipp: [0, 0, 4] }),
    ]);
    const result = checkMprEligibility(stack);
    expect(result.allowed).toBe(true);
    expect(result.nonUniformSpacing).toBe(false);
    expect(result.sliceCount).toBe(3);
    expect(result.zSpacing).toBe(2);
    expect(result.message).toBeUndefined();
  });

  it('层间距不一致：允许但提示按 IPP 重采样', () => {
    const stack = makeStack([
      makeItem(1, { ipp: [0, 0, 0] }),
      makeItem(2, { ipp: [0, 0, 2] }),
      makeItem(3, { ipp: [0, 0, 5] }),
    ]);
    const result = checkMprEligibility(stack);
    expect(result.allowed).toBe(true);
    expect(result.nonUniformSpacing).toBe(true);
    expect(result.message).toContain('IPP');
    // 平均 z 间距 = (2+3)/2 = 2.5
    expect(result.zSpacing).toBe(2.5);
  });

  it('增强型多帧逐帧位置驱动层距判定（不使用实例级 IPP）', () => {
    // 同一条 2 帧增强记录展开的两帧：第 1 帧 z=0、第 2 帧 z=2 → 层距 2（均匀）
    const frames: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 0, 2],
    ];
    const stack = makeStack([
      makeItem(1, { perFrame: frames }),
      makeItem(2, { perFrame: frames }),
    ]);
    const result = checkMprEligibility(stack);
    expect(result.allowed).toBe(true);
    expect(result.nonUniformSpacing).toBe(false);
    expect(result.zSpacing).toBe(2);
  });
});