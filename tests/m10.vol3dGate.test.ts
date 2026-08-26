/**
 * M10-C 3D 体绘制门槛判定（FR-7.1，同类 FR-6.7）：数据门槛（复用 MPR 门槛）
 * + WebGL2 能力门槛；hasWebGL2 可注入检测。
 */
import { describe, expect, it } from 'vitest';
import {
  checkVolume3dEligibility,
  hasWebGL2,
  volume3dDataReasonMessage,
} from '../src/features/volume3d/gate';
import type { SeriesStack, StackItem } from '../src/features/series/buildStacks';
import type { DicomInstanceSummary } from '../src/dicom/parseDicom';

function makeItem(frameNumber: number, overrides: Partial<DicomInstanceSummary> = {}): StackItem {
  return {
    imageId: `dcm-file://k${frameNumber}`,
    fileName: `k${frameNumber}.dcm`,
    frameNumber,
    summary: {
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
      pixelSpacing: [0.5, 0.5],
      imagePositionPatient: [0, 0, (frameNumber - 1) * 2],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      frameOfReferenceUid: '1.2.f',
      perFrameImagePositions: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 16,
      columns: 16,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: undefined,
      sopInstanceUid: `sop${frameNumber}`,
      transferSyntaxUid: undefined,
      ...overrides,
    } as DicomInstanceSummary,
  };
}

function makeStack(itemCount: number): SeriesStack {
  const items = Array.from({ length: itemCount }, (_, i) => makeItem(i + 1));
  return {
    seriesUid: '1.2.s',
    modality: 'CT',
    description: undefined,
    items,
    patientId: 'P1',
    patientName: '张^三',
    studyInstanceUid: undefined,
    studyDate: undefined,
    studyDescription: undefined,
  };
}

describe('hasWebGL2（可注入创建 canvas）', () => {
  it('getContext 返回对象 → true', () => {
    expect(
      hasWebGL2({
        createCanvas: () => ({ getContext: () => ({}) as unknown }),
      }),
    ).toBe(true);
  });

  it('getContext 返回 null（jsdom 等）→ false', () => {
    expect(
      hasWebGL2({ createCanvas: () => ({ getContext: () => null }) }),
    ).toBe(false);
  });

  it('createCanvas 返回 null / 抛错 → false', () => {
    expect(hasWebGL2({ createCanvas: () => null })).toBe(false);
    expect(
      hasWebGL2({
        createCanvas: () => {
          throw new Error('no canvas');
        },
      }),
    ).toBe(false);
  });
});

describe('checkVolume3dEligibility（FR-7.1 门槛）', () => {
  it('无序列 → 禁止（数据门槛，提示加载序列）', () => {
    const result = checkVolume3dEligibility(null, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DATA_NOT_READY');
    expect(result.message).toContain('加载序列');
    expect(result.data.sliceCount).toBe(0);
  });

  it('层数 < 2 → 禁止（3D 需要至少 2 层）', () => {
    const result = checkVolume3dEligibility(makeStack(1), true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DATA_NOT_READY');
    expect(result.message).toContain('至少 2 层');
    expect(result.message).toContain('3D');
  });

  it('缺像素间距 → 禁止', () => {
    const stack = makeStack(2);
    stack.items = stack.items.map((item) => ({
      ...item,
      summary: { ...item.summary, pixelSpacing: undefined },
    })) as unknown as StackItem[];
    const result = checkVolume3dEligibility(stack, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DATA_NOT_READY');
    expect(result.message).toContain('像素间距');
  });

  it('缺 IPP → 禁止', () => {
    const stack = makeStack(2);
    stack.items = stack.items.map((item) => ({
      ...item,
      summary: { ...item.summary, imagePositionPatient: undefined },
    })) as unknown as StackItem[];
    const result = checkVolume3dEligibility(stack, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('DATA_NOT_READY');
    expect(result.message).toContain('IPP');
  });

  it('数据合法但 WebGL2 缺失 → 禁止并提示不支持', () => {
    const result = checkVolume3dEligibility(makeStack(2), false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_WEBGL2');
    expect(result.message).toContain('不支持 WebGL2');
  });

  it('数据合法 + WebGL2 → 允许，给出数据门槛明细', () => {
    const result = checkVolume3dEligibility(makeStack(3), true);
    expect(result.allowed).toBe(true);
    expect(result.webgl2).toBe(true);
    expect(result.data.sliceCount).toBe(3);
    expect(result.data.zSpacing).toBe(2);
  });

  it('层间距不一致：数据允许但带重采样提示', () => {
    const stack = makeStack(3);
    stack.items = stack.items.map((item, index) => ({
      ...item,
      summary: {
        ...item.summary,
        // 层距：0→10→30（两段分别 10/20，不一致）
        imagePositionPatient: [0, 0, [0, 10, 30][index] as number],
      },
    })) as unknown as StackItem[];
    const result = checkVolume3dEligibility(stack, true);
    expect(result.allowed).toBe(true);
    expect(result.data.nonUniformSpacing).toBe(true);
  });
});

describe('volume3dDataReasonMessage', () => {
  it('各原因分别映射为 3D 语境中文提示', () => {
    expect(volume3dDataReasonMessage('NO_SERIES')).toBe('请先在视口中加载序列');
    expect(volume3dDataReasonMessage('TOO_FEW_SLICES')).toBe('3D 体绘制需要至少 2 层图像');
    expect(volume3dDataReasonMessage('MISSING_PIXEL_SPACING')).toContain('像素间距');
    expect(volume3dDataReasonMessage('MISSING_IPP')).toContain('IPP');
    expect(volume3dDataReasonMessage(undefined, '兜底')).toBe('兜底');
  });
});

describe('hasWebGL2 运行时行为（jsdom 兜底）', () => {
  it('jsdom document 无 WebGL2 → hasWebGL2 为 false 且不抛错', () => {
    const result = hasWebGL2();
    expect(typeof result).toBe('boolean');
  });
});