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
}

/** FR-2.3 最小排序比较器：InstanceNumber → SliceLocation → 文件名 */
export function compareInstances(a: OpenedDicomFile, b: OpenedDicomFile): number {
  const instanceA = a.summary.instanceNumber ?? Number.POSITIVE_INFINITY;
  const instanceB = b.summary.instanceNumber ?? Number.POSITIVE_INFINITY;
  if (instanceA !== instanceB) {
    return instanceA - instanceB;
  }
  const sliceA = a.summary.sliceLocation ?? 0;
  const sliceB = b.summary.sliceLocation ?? 0;
  if (sliceA !== sliceB) {
    return sliceA - sliceB;
  }
  return a.fileName.localeCompare(b.fileName, 'en');
}

function toStackItems(file: OpenedDicomFile): StackItem[] {
  const frames = Math.max(1, file.summary.numberOfFrames);
  const items: StackItem[] = [];
  for (let frameNumber = 1; frameNumber <= frames; frameNumber++) {
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
    });
  }

  stacks.sort((a, b) => a.seriesUid.localeCompare(b.seriesUid, 'en'));
  return stacks;
}
