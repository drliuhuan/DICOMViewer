/**
 * DICOM SR 导出（FR-5.12，M10-D）。
 *
 * 采用 dcmjs `adapters.Cornerstone.MeasurementReport.generateReport(toolState,
 * metadataProvider)` 生成 TID1500「Imaging Measurements」最小合法 SR，
 * Part-10 字节流可直接被 dcmtk dcmdump 解析；单测用 dcmjs DicomMessage.readFile
 * 回读验证。
 *
 * cornerstone3D 的标注对象结构与 dcmjs 测量适配器期望的 cornerstone V4 扁平结构
 * 不同（3D 为 {data:{handles,cachedStats}}，V4 为 {handles,length/area}），
 * 因此这里做显式映射（annotationToV4Measurement）。
 * 支持工具：Length / Angle / RectangleROI / EllipticalROI。
 */
import { adapters, data } from 'dcmjs';
import type { AnnotationLike } from './annotationModel';
import { baseImageIdOf } from './annotationModel';
import { cobbEndpointsForSr } from './cobbGeometry';

/** cornerstone V4 测量适配器（dcmjs 公开导出，接收扁平测量结构） */
const { MeasurementReport } = adapters.Cornerstone;
const { DicomMetaDictionary, datasetToDict } = data;

/** cornerstone3D 工具名 → dcmjs 测量适配器工具类型 */
export const SR_TOOL_TYPE_MAP: Readonly<Record<string, string>> = {
  Length: 'Length',
  Angle: 'Angle',
  RectangleROI: 'RectangleRoi',
  EllipticalROI: 'EllipticalRoi',
  // M11 任务 3：Cobb 角沿用 Angle（TID1419 三点半角）通道——
  // 四点两线由 cobbGeometry.cobbEndpointsForSr 折算为 start/middle/end
  CobbAngle: 'Angle',
} as const;

export const SR_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.33'; // ComprehensiveSR

/** dcmjs 需要的每 imageId 元数据模块（鸭子类型，测试可构造） */
export interface SrSopMetadata {
  sopClassUID: string;
  sopInstanceUID: string;
  frame: number;
}

export interface SrSeriesMetadata {
  studyInstanceUID: string;
  seriesInstanceUID: string;
}

export interface SrMetadataResolver {
  /** referencedImageId → 引用实例信息 */
  resolveSop: (imageId: string) => SrSopMetadata | null;
  /** referencedImageId → 检查/序列信息 */
  resolveSeries: (imageId: string) => SrSeriesMetadata | null;
}

/** 构造 dcmjs `metadataProvider`（get(type, imageId)）。 */
export function createSrMetadataProvider(resolver: SrMetadataResolver): {
  get: (type: string, imageId: string) => unknown;
} {
  return {
    get: (type: string, imageId: string): unknown => {
      if (type === 'generalSeriesModule') {
        return resolver.resolveSeries(imageId);
      }
      if (type === 'sopCommonModule') {
        return resolver.resolveSop(imageId);
      }
      if (type === 'frameNumber') {
        return resolver.resolveSop(imageId)?.frame;
      }
      return undefined;
    },
  };
}

/** 2D 点归一化（dcmjs 扁平测量结构使用 {x,y}） */
function point2d(point: readonly number[] | undefined): { x: number; y: number } | null {
  if (point === undefined || point.length < 2) {
    return null;
  }
  const x = point[0];
  const y = point[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: x as number, y: y as number };
}

/**
 * cornerstone3D 标注 → dcmjs 测量适配器扁平结构。
 * 无 cachedStats（未完成/统计缺失）或点位不足时返回 null（跳过该条）。
 */
export function annotationToV4Measurement(annotation: AnnotationLike): unknown | null {
  const toolName = annotation.metadata?.toolName ?? '';
  const srType = SR_TOOL_TYPE_MAP[toolName];
  if (srType === undefined) {
    return null;
  }
  const stats = annotation.data?.cachedStats;
  const statsKey = stats !== undefined ? Object.keys(stats)[0] : undefined;
  const target = stats !== undefined && statsKey !== undefined ? stats[statsKey] : undefined;
  const points = annotation.data?.handles?.points;
  if (points === undefined || points.length < 2) {
    return null;
  }

  if (srType === 'Length') {
    const length = typeof target?.length === 'number' ? target.length : undefined;
    const start = point2d(points[0]);
    const end = point2d(points[1]);
    if (length === undefined || start === null || end === null) {
      return null;
    }
    return { handles: { start, end }, length };
  }

  if (srType === 'Angle') {
    // M11 任务 3：Cobb 角（四点两线）→ 三点半角表示（顶点=两线交点，
    // start/end 取各自离交点最远的端点）；平行/共线或点位不足时跳过。
    if (toolName === 'CobbAngle') {
      const statsEntry = target ?? undefined;
      const displayAngle =
        typeof statsEntry?.displayAngle === 'number'
          ? (statsEntry.displayAngle as number)
          : typeof statsEntry?.angle === 'number'
            ? (statsEntry.angle as number)
            : undefined;
      if (displayAngle === undefined) {
        return null;
      }
      const apex = cobbEndpointsForSr(points);
      if (apex === null) {
        return null; // 平行线无交点，无法折算三点半角
      }
      return { handles: apex, rAngle: displayAngle };
    }

    const angle = typeof target?.angle === 'number' ? target.angle : undefined;
    if (angle === undefined || points.length < 3) {
      return null;
    }
    const start = point2d(points[0]);
    const middle = point2d(points[1]);
    const end = point2d(points[2]);
    if (start === null || middle === null || end === null) {
      return null;
    }
    return { handles: { start, middle, end }, rAngle: angle };
  }

  // RectangleROI / EllipticalROI：对角两角点 + 面积
  const area = typeof target?.area === 'number' ? target.area : undefined;
  if (area === undefined) {
    return null;
  }
  const start = point2d(points[0]);
  const end = point2d(points[points.length - 1]);
  if (start === null || end === null) {
    return null;
  }
  return { handles: { start, end }, cachedStats: { area } };
}

export interface SrBuildOptions {
  /** 缺省病人/检查/序列信息（测试与无元数据场景用兜底值） */
  patientName?: string;
  patientId?: string;
}

/**
 * 生成 DICOM SR Part-10 字节流（ArrayBuffer）。
 * @param annotations cornerstone3D 标注（仅导出有 referencedImageId 且可映射的类型）
 * @param resolver imageId → SOP/系列元数据解析
 * @returns ArrayBuffer（Part-10）；无有效测量时返回 null
 */
export function buildMeasurementSr(
  annotations: readonly AnnotationLike[],
  resolver: SrMetadataResolver,
  options: SrBuildOptions = {},
): ArrayBuffer | null {
  // 按 referencedImageId 分组，构造 dcmjs 的 toolState（V4 扁平测量结构）
  const toolState: Record<string, Record<string, unknown[]>> = {};
  const imageOrder: string[] = [];
  for (const annotation of annotations) {
    const imageId = annotation.metadata?.referencedImageId;
    if (typeof imageId !== 'string' || imageId === '') {
      continue;
    }
    if (resolver.resolveSop(imageId) === null) {
      continue;
    }
    const srType = SR_TOOL_TYPE_MAP[annotation.metadata?.toolName ?? ''];
    if (srType === undefined) {
      continue;
    }
    const measurement = annotationToV4Measurement(annotation);
    if (measurement === null) {
      continue;
    }
    const key = baseImageIdOf(imageId);
    toolState[key] ??= {};
    toolState[key][srType] ??= [];
    toolState[key][srType].push(measurement);
    if (!imageOrder.includes(key)) {
      imageOrder.push(key);
    }
  }
  if (imageOrder.length === 0) {
    return null;
  }

  const provider = createSrMetadataProvider(resolver);
  const report = MeasurementReport.generateReport(toolState, provider, {}) as {
    dataset?: Record<string, unknown>;
  };
  const dataset = report.dataset;

  // 补齐最小合法 SR 所需字段（dcmjs DerivedDataset 默认未写全）
  const first = imageOrder[0];
  const series = first !== undefined ? resolver.resolveSeries(first) : null;
  dataset!.SOPClassUID = SR_SOP_CLASS_UID;
  dataset!.SOPInstanceUID = DicomMetaDictionary.uid();
  dataset!.StudyInstanceUID =
    typeof dataset!.StudyInstanceUID === 'string' && dataset!.StudyInstanceUID !== ''
      ? dataset!.StudyInstanceUID
      : (series?.studyInstanceUID ?? DicomMetaDictionary.uid());
  dataset!.SeriesInstanceUID =
    typeof dataset!.SeriesInstanceUID === 'string' && dataset!.SeriesInstanceUID !== ''
      ? dataset!.SeriesInstanceUID
      : (series?.seriesInstanceUID ?? DicomMetaDictionary.uid());
  dataset!.Modality = 'SR';
  if (typeof dataset!.PatientName === 'undefined') {
    dataset!.PatientName = options.patientName ?? 'ANONYMOUS';
  }
  if (typeof dataset!.PatientID === 'undefined') {
    dataset!.PatientID = options.patientId ?? 'ANON';
  }

  return datasetToDict(dataset!).write() as ArrayBuffer;
}

const { DicomMessage } = data;

/** 从 SR 字节流回读关键字段（测试用；非法输入返回 null） */
export function readSrInfo(part10: ArrayBuffer | Uint8Array): {
  sopClassUid: string;
  sopInstanceUid: string;
  hasContentSequence: boolean;
} | null {
  if (ArrayBuffer.isView(part10)) {
    const view = part10;
    part10 = view.buffer.slice(
      view.byteOffset,
      view.byteOffset + view.byteLength,
    ) as ArrayBuffer;
  }
  try {
    const parsed = DicomMessage.readFile(part10 as ArrayBuffer) as {
      dict: Record<string, { Value?: unknown }>;
    };
    const dict = parsed.dict;
    // dcmjs readFile 的 dict 键为大写 tag（如 '0020000D'）；统一转大写后查表（测试用 '0020000d'）
    const readTag = (tag: string): string => tag.toUpperCase();
    const valueOf = (tag: string): string | undefined => {
      const item = dict[readTag(tag)];
      const value = item?.Value;
      if (Array.isArray(value)) {
        const raw = value[0];
        return typeof raw === 'string' ? raw : undefined;
      }
      return undefined;
    };
    const contentSequence = dict[readTag('0040a730')];
    return {
      sopClassUid: valueOf('00080016') ?? '',
      sopInstanceUid: valueOf('00080018') ?? '',
      hasContentSequence:
        contentSequence !== undefined && contentSequence.Value !== undefined,
    };
  } catch {
    return null;
  }
}