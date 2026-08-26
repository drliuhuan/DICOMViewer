/**
 * 图像堆栈构建（FR-2.3 的 M1 最小实现）。
 *
 * - 按序列（SeriesInstanceUID）分组，缺失 UID 的文件各自成组；
 * - 组内排序：InstanceNumber → SliceLocation → 文件名（FR-2.3 最小集，
 *   完整的 IPP 空间位置排序与序列树在 M2 实现）；
 * - 多帧文件按 NumberOfFrames 展开为逐帧 imageId（`?frame=N`）；
 * - 单文件也包装为 1 帧堆栈，统一处理。
 *
 * 全部为纯函数，可在 Node 环境下单元测试。
 */
import { withFrameNumber } from '../../dicom/imageId';
import type { DicomInstanceSummary } from '../../dicom/parseDicom';
import type { OpenedDicomFile } from '../loading/openDicomFiles';

/** 堆栈内一帧的可显示条目 */
export interface StackItem {
  imageId: string;
  /** 来源文件名 */
  fileName: string;
  /** 帧号（1 起始）；单帧文件恒为 1 */
  frameNumber: number;
  /** 实例级元数据（多帧展开时同实例各帧共享） */
  summary: DicomInstanceSummary;
}

/** 一个可加载到视口的图像堆栈（对应一个序列） */
export interface SeriesStack {
  seriesUid: string;
  modality: string;
  description: string | undefined;
  items: StackItem[];
  /** ── 四级元数据层级（FR-1.10）：取自组内首个文件，供序列树分组 ── */
  patientId: string | undefined;
  patientName: string;
  studyInstanceUid: string | undefined;
  studyDate: string | undefined;
  studyDescription: string | undefined;
  /** 远程来源标记（FR-13.5，取自组内首个文件；本地序列恒为 undefined） */
  remoteSource?: {
    serverName: string;
    studyUid: string;
  };
}

/** 切片法向量：ImageOrientationPatient 行/列余弦的叉积（仅用于投影比较，无需归一化） */
export function sliceNormal(
  summary: DicomInstanceSummary,
): [number, number, number] | undefined {
  const iop = summary.imageOrientationPatient;
  if (!iop) {
    return undefined;
  }
  const row = [iop[0], iop[1], iop[2]];
  const column = [iop[3], iop[4], iop[5]];
  return [
    row[1]! * column[2]! - row[2]! * column[1]!,
    row[2]! * column[0]! - row[0]! * column[2]!,
    row[0]! * column[1]! - row[1]! * column[0]!,
  ];
}

/** 投影相等判定阈值（mm 级浮点容差） */
const PROJECTION_EPSILON = 1e-4;

/**
 * FR-2.3 第三级排序键：ImagePositionPatient 沿切片法向量的投影。
 * 无 IOP 时退回 z 分量（常见轴位数据的等价近似）；缺失 IPP 返回 undefined。
 */
export function sliceProjection(summary: DicomInstanceSummary): number | undefined {
  const position = summary.imagePositionPatient;
  if (!position) {
    return undefined;
  }
  const normal = sliceNormal(summary);
  if (!normal) {
    return position[2];
  }
  return (
    position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2]
  );
}

/**
 * FR-2.3 完整排序链：InstanceNumber → SliceLocation → IPP 法向量投影 → 文件名。
 * 缺失 InstanceNumber 排最后；SliceLocation 仅在双方都存在时参与；
 * 投影差在浮点容差内视为相等，交由文件名稳定收尾。
 */
export function compareInstances(a: OpenedDicomFile, b: OpenedDicomFile): number {
  const instanceA = a.summary.instanceNumber ?? Number.POSITIVE_INFINITY;
  const instanceB = b.summary.instanceNumber ?? Number.POSITIVE_INFINITY;
  if (instanceA !== instanceB) {
    return instanceA - instanceB;
  }
  const sliceA = a.summary.sliceLocation;
  const sliceB = b.summary.sliceLocation;
  if (sliceA !== undefined && sliceB !== undefined && sliceA !== sliceB) {
    return sliceA - sliceB;
  }
  const projectionA = sliceProjection(a.summary);
  const projectionB = sliceProjection(b.summary);
  if (
    projectionA !== undefined &&
    projectionB !== undefined &&
    Math.abs(projectionA - projectionB) > PROJECTION_EPSILON
  ) {
    return projectionA - projectionB;
  }
  return a.fileName.localeCompare(b.fileName, 'en');
}

/** 多帧实例展开时的帧序：优先按逐帧位置投影升序，否则自然帧序 */
function orderedFrameNumbers(summary: DicomInstanceSummary): number[] {
  const frames = Math.max(1, summary.numberOfFrames);
  const natural = Array.from({ length: frames }, (_, index) => index + 1);
  const positions = summary.perFrameImagePositions;
  if (frames <= 1 || !positions || positions.length !== frames) {
    return natural;
  }
  const projections = positions.map((position) =>
    sliceProjection({
      ...summary,
      imagePositionPatient: position,
    }),
  );
  if (projections.some((value) => value === undefined)) {
    return natural;
  }
  const sortable = natural.map((frameNumber, index) => ({
    frameNumber,
    projection: projections[index] as number,
  }));
  // 稳定排序（相同投影保持自然帧序）
  sortable.sort((a, b) => a.projection - b.projection);
  return sortable.map((entry) => entry.frameNumber);
}

function toStackItems(file: OpenedDicomFile): StackItem[] {
  const frames = Math.max(1, file.summary.numberOfFrames);
  const frameOrder =
    frames > 1 ? orderedFrameNumbers(file.summary) : [1];
  const items: StackItem[] = [];
  for (const frameNumber of frameOrder) {
    items.push({
      imageId:
        frames > 1 ? withFrameNumber(file.baseImageId, frameNumber) : file.baseImageId,
      fileName: file.fileName,
      frameNumber,
      summary: file.summary,
    });
  }
  return items;
}

/**
 * 将已打开文件按序列分组并排序，形成图像堆栈列表。
 * @param opened 已成功解析的文件（任意顺序）
 * @returns 序列堆栈数组（按序列号/UID 排序，保证面板顺序稳定）
 */
export function buildSeriesStacks(opened: OpenedDicomFile[]): SeriesStack[] {
  const groups = new Map<string, OpenedDicomFile[]>();
  for (const file of opened) {
    const uid = file.summary.seriesInstanceUid ?? `__file__:${file.fileName}`;
    const group = groups.get(uid);
    if (group) {
      group.push(file);
    } else {
      groups.set(uid, [file]);
    }
  }

  const stacks: SeriesStack[] = [];
  for (const [uid, files] of groups) {
    files.sort(compareInstances);
    const first = files[0];
    if (!first) {
      continue;
    }
    stacks.push({
      seriesUid: uid,
      modality: first.summary.modality,
      description:
        first.summary.seriesDescription ??
        first.summary.studyDescription ??
        undefined,
      items: files.flatMap(toStackItems),
      patientId: first.summary.patientId,
      patientName: first.summary.patientName,
      studyInstanceUid: first.summary.studyInstanceUid,
      studyDate: first.summary.studyDate,
      studyDescription: first.summary.studyDescription,
      remoteSource: first.remoteSource,
    });
  }

  stacks.sort((a, b) => a.seriesUid.localeCompare(b.seriesUid, 'en'));
  return stacks;
}
