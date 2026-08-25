/**
 * DICOM Part-10 解析封装（基于 dicom-parser）。
 *
 * 职责：魔数校验、数据集解析、实例级元数据摘要提取。
 * 该模块保持纯函数、无浏览器 API 依赖，便于单元测试覆盖。
 */
import * as dicomParser from 'dicom-parser';

/** 非 DICOM / 无法解析的文件错误。M2 会升级为完整错误报告列表。 */
export class NotDicomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotDicomError';
  }
}

/**
 * 有 DICM 魔数但内容损坏/截断导致解析失败。
 * 继承 NotDicomError 以兼容既有捕获方，同时供错误报告区分「非 DICOM 跳过」与「坏文件」。
 */
export class ParseFailureError extends NotDicomError {
  constructor(message: string) {
    super(message);
    this.name = 'ParseFailureError';
  }
}

const DICM_MAGIC_OFFSET = 128;

/** 校验 Part-10 前导：128 字节 preamble + "DICM" 魔数 */
export function hasDicomPreamble(buffer: ArrayBufferLike): boolean {
  if (buffer.byteLength < DICM_MAGIC_OFFSET + 4) {
    return false;
  }
  const magic = new Uint8Array(buffer, DICM_MAGIC_OFFSET, 4);
  return (
    magic[0] === 0x44 && // 'D'
    magic[1] === 0x49 && // 'I'
    magic[2] === 0x43 && // 'C'
    magic[3] === 0x4d //    'M'
  );
}

/** 实例级元数据摘要（M1：FR-2.3 排序 + FR-3/FR-4 覆盖文字所需字段） */
export interface DicomInstanceSummary {
  patientName: string;
  patientId: string | undefined;
  patientSex: string | undefined;
  patientAge: string | undefined;
  modality: string;
  /** 检查实例 UID（FR-1.10 四级元数据：患者→检查→序列→实例 的检查层分组键） */
  studyInstanceUid: string | undefined;
  studyDate: string | undefined;
  studyDescription: string | undefined;
  institutionName: string | undefined;
  seriesInstanceUid: string | undefined;
  seriesNumber: number | undefined;
  seriesDescription: string | undefined;
  instanceNumber: number | undefined;
  sliceLocation: number | undefined;
  sliceThickness: number | undefined;
  pixelSpacing: [number, number] | undefined;
  /** 图像位置（0020,0032），FR-2.3 第三级排序键（切片法向量投影） */
  imagePositionPatient: [number, number, number] | undefined;
  imageOrientationPatient: [number, number, number, number, number, number] | undefined;
  /** 帧参照 UID（0020,0010）：跨序列空间对齐/融合的前提判断（FR-9.2/9.4） */
  frameOfReferenceUid?: string | undefined;
  /**
   * 增强型多帧（Enhanced CT/MR）Per-frame Functional Groups Sequence
   * （5200,9230）→ Plane Position Sequence（0020,9113）中逐帧的
   * ImagePositionPatient，数组下标 = 帧号-1。
   * 任一帧缺失或解析异常时为 undefined（退回自然帧序，报告中注明限制）。
   */
  perFrameImagePositions: Array<[number, number, number]> | undefined;
  windowWidth: number | undefined;
  windowCenter: number | undefined;
  /** 重缩放斜率（0028,1053）：原始值→标准值（如 HU）的线性变换系数（FR-8/FR-9 统计用原始值） */
  rescaleSlope?: number | undefined;
  /** 重缩放截距（0028,1052）：原始值→标准值的线性变换常数 */
  rescaleIntercept?: number | undefined;
  rows: number;
  columns: number;
  bitsAllocated: number | undefined;
  numberOfFrames: number;
  sopClassUid: string | undefined;
  sopInstanceUid: string | undefined;
  transferSyntaxUid: string | undefined;
}

/** 将任意输入规整为字节视图 */
function toUint8View(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  );
}

/**
 * 解析 DICOM Part-10 字节流。
 * @throws NotDicomError 缺少 DICM 魔数或解析失败
 */
export function parseDicomArrayBuffer(
  input: ArrayBuffer | ArrayBufferView,
): dicomParser.DataSet {
  const view = toUint8View(input);
  if (!hasDicomPreamble(view.buffer)) {
    throw new NotDicomError('未找到 DICM 文件头，不是有效的 DICOM Part-10 文件');
  }
  try {
    return dicomParser.parseDicom(view);
  } catch (error) {
    throw new ParseFailureError(
      `DICOM 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function safeString(dataSet: dicomParser.DataSet, tag: string): string | undefined {
  try {
    const value = dataSet.string(tag);
    const trimmed = value?.replace(/\0+$/, '').trim();
    return trimmed ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function safeUint16(dataSet: dicomParser.DataSet, tag: string): number | undefined {
  try {
    const value = dataSet.uint16(tag);
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** 解析 IS/DS/US 等数值字符串 VR（取首个值） */
function safeNumber(dataSet: dicomParser.DataSet, tag: string): number | undefined {
  const raw = safeString(dataSet, tag);
  if (raw === undefined) {
    return undefined;
  }
  const first = raw.split('\\')[0]?.trim();
  if (first === undefined || first === '') {
    return undefined;
  }
  const value = Number(first);
  return Number.isFinite(value) ? value : undefined;
}

/** 解析 DS 多值 VR（如 PixelSpacing / ImageOrientationPatient） */
function safeNumberArray(
  dataSet: dicomParser.DataSet,
  tag: string,
): number[] | undefined {
  const raw = safeString(dataSet, tag);
  if (raw === undefined) {
    return undefined;
  }
  const values = raw
    .split('\\')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
  return values.length > 0 ? values : undefined;
}

function toTuple3(values: number[] | undefined): [number, number, number] | undefined {
  return values !== undefined && values.length >= 3
    ? [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0]
    : undefined;
}

/**
 * 提取增强型多帧的逐帧图像位置（FR-1.8）：
 * Per-frame Functional Groups Sequence（5200,9230）
 *   → 各帧 Plane Position Sequence（0020,9113）
 *   → ImagePositionPatient（0020,0032）。
 * 任一帧缺失/异常时整体返回 undefined（调用方退回自然帧序）。
 */
function extractPerFrameImagePositions(
  dataSet: dicomParser.DataSet,
): Array<[number, number, number]> | undefined {
  try {
    const items = dataSet.elements['x52009230']?.items;
    if (!items || items.length === 0) {
      return undefined;
    }
    const positions: Array<[number, number, number]> = [];
    for (const item of items) {
      const planePositionItem = item.dataSet?.elements['x00209113']?.items?.[0]?.dataSet;
      if (!planePositionItem) {
        return undefined;
      }
      const position = toTuple3(safeNumberArray(planePositionItem, 'x00200032'));
      if (!position) {
        return undefined;
      }
      positions.push(position);
    }
    return positions;
  } catch {
    return undefined;
  }
}

/**
 * 从已解析数据集中提取实例级元数据摘要。
 * 所有字段容错读取：单个 Tag 异常不影响整体。
 */
export function extractInstanceSummary(
  dataSet: dicomParser.DataSet,
): DicomInstanceSummary {
  const numberOfFramesRaw = safeString(dataSet, 'x00280008'); // NumberOfFrames 为 IS VR
  const numberOfFrames = numberOfFramesRaw !== undefined ? Number(numberOfFramesRaw) : 1;
  const pixelSpacing = safeNumberArray(dataSet, 'x00280030');
  const iop = safeNumberArray(dataSet, 'x00200037');
  const pixelSpacingTuple: [number, number] | undefined =
    pixelSpacing !== undefined && pixelSpacing.length >= 2
      ? [pixelSpacing[0] ?? 0, pixelSpacing[1] ?? 0]
      : undefined;
  return {
    patientName: safeString(dataSet, 'x00100010') ?? '(无姓名)',
    patientId: safeString(dataSet, 'x00100020'),
    patientSex: safeString(dataSet, 'x00100040'),
    patientAge: safeString(dataSet, 'x00101010'),
    modality: safeString(dataSet, 'x00080060') ?? '?',
    studyInstanceUid: safeString(dataSet, 'x0020000d'),
    studyDate: safeString(dataSet, 'x00080020'),
    studyDescription: safeString(dataSet, 'x00081030'),
    institutionName: safeString(dataSet, 'x00080080'),
    seriesInstanceUid: safeString(dataSet, 'x0020000e'),
    seriesNumber: safeNumber(dataSet, 'x00200011'),
    seriesDescription: safeString(dataSet, 'x0008103e'),
    instanceNumber: safeNumber(dataSet, 'x00200013'),
    sliceLocation: safeNumber(dataSet, 'x00201041'),
    sliceThickness: safeNumber(dataSet, 'x00180050'),
    pixelSpacing: pixelSpacingTuple,
    imagePositionPatient: toTuple3(safeNumberArray(dataSet, 'x00200032')),
    imageOrientationPatient:
      iop !== undefined && iop.length >= 6
        ? [
            iop[0] ?? 0,
            iop[1] ?? 0,
            iop[2] ?? 0,
            iop[3] ?? 0,
            iop[4] ?? 0,
            iop[5] ?? 0,
          ]
        : undefined,
    frameOfReferenceUid: safeString(dataSet, 'x00200010'),
    perFrameImagePositions:
      numberOfFrames > 1 ? extractPerFrameImagePositions(dataSet) : undefined,
    windowWidth: safeNumber(dataSet, 'x00281051'),
    windowCenter: safeNumber(dataSet, 'x00281050'),
    rescaleSlope: safeNumber(dataSet, 'x00281053'),
    rescaleIntercept: safeNumber(dataSet, 'x00281052'),
    rows: safeUint16(dataSet, 'x00280010') ?? 0,
    columns: safeUint16(dataSet, 'x00280011') ?? 0,
    bitsAllocated: safeUint16(dataSet, 'x00280100'),
    numberOfFrames:
      Number.isFinite(numberOfFrames) && numberOfFrames > 0 ? numberOfFrames : 1,
    sopClassUid: safeString(dataSet, 'x00080016'),
    sopInstanceUid: safeString(dataSet, 'x00080018'),
    transferSyntaxUid: safeString(dataSet, 'x00020010'),
  };
}
