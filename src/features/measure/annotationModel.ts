/**
 * 标注数据模型：面板快照 / 标注-帧关联 / JSON 导入导出（FR-5.9/5.10/5.11，M10-D）。
 *
 * - cornerstone 标注天然按 imageId 绑定（metadata.referencedImageId），
 *   Snapshot 据此推断「所属序列/帧/视口」，实现仅当前帧渲染语义（FR-5.10）；
 * - 帧号：单帧每文件序列按 imageId→栈内序号解析；多帧按 ?frame=N；
 *   MPR 视口标注按 metadata.sliceIndex（平面切换对应帧）。
 * - 导出 JSON 含 SOP UID / 帧号 / 坐标（完整标注对象）/ 类型 / 值 / 单位，
 *   导入可恢复（FR-5.11）。
 *
 * 全部纯函数（标注对象以结构鸭子类型传入），Node 下单测。
 */
import { formatFixed2, countFromStatsArray } from './roiStats';

/** cornerstone 标注的最小鸭子类型（测试可构造） */
export interface AnnotationLike {
  annotationUID?: string;
  metadata?: {
    toolName?: string;
    referencedImageId?: string;
    sliceIndex?: number;
    viewPlaneNormal?: readonly number[];
  };
  data?: {
    cachedStats?: Record<string, Record<string, unknown>>;
    handles?: { points?: Array<readonly number[]> };
  };
  isVisible?: boolean;
  isSelected?: boolean;
  highlighted?: boolean;
}

/** 快照解析依赖（由 App 用已加载序列构建；测试可注入） */
export interface AnnotationSnapshotDeps {
  /** imageId（含帧查询）→ 序列 UID；单个 base imageId 去除查询后查表 */
  resolveSeries?: (imageId: string) => string | null;
  /** seriesUid → 展示该序列的视口 id 列表 */
  viewportsForSeries?: (seriesUid: string) => readonly string[];
  /** imageId → 栈内 0 基序号（单帧序列帧号来源） */
  resolveFrameIndex?: (imageId: string) => number | null;
  /** imageId → SOP Instance UID（导出用，FR-5.11） */
  resolveSop?: (imageId: string) => string | null;
  /** imageId → 像素间距（缺失/不可用返回 undefined；用于物理尺寸提示） */
  resolveSpacing?: (imageId: string) => readonly number[] | undefined;
  /** MPR 模式是否激活（标注 viewPlaneNormal → 平面视口） */
  mprActive?: boolean;
}

export interface AnnotationRow {
  annotationUID: string;
  toolName: string;
  toolLabel: string;
  seriesUid: string | null;
  viewportId: string | null;
  frame: number | null;
  imageId: string | null;
  isMpr: boolean;
  /** 面板单行摘要（如「长度 12.34 mm」） */
  text: string;
  /** 多行详情（ROI 统计逐项） */
  lines: string[];
  numericValue: number | null;
  unit: string | null;
  isVisible: boolean;
  isSelected: boolean;
  spacingUsable: boolean;
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  Length: '长度',
  Angle: '角度',
  RectangleROI: '矩形 ROI',
  EllipticalROI: '椭圆 ROI',
  Probe: '点标注',
  ArrowAnnotate: '箭头标注',
  // M11 任务 3：Cobb 角（两条线段夹角）
  CobbAngle: 'Cobb 角',
};

export function annotationToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

/** 工具排序优先级（批量快照 / 导出按 系列→帧→工具 稳定排序，FR-5.11） */
const TOOL_SORT_ORDER: Readonly<Record<string, number>> = {
  Length: 0,
  Angle: 1,
  CobbAngle: 2,
  RectangleROI: 3,
  EllipticalROI: 4,
  Probe: 5,
  ArrowAnnotate: 6,
};

/** 取 cachedStats 的第一个 targetId 条目 */
export function firstCachedStats(
  annotation: AnnotationLike,
): Record<string, unknown> | undefined {
  const cached = annotation.data?.cachedStats;
  if (!cached) {
    return undefined;
  }
  const key = Object.keys(cached)[0];
  return key === undefined ? undefined : cached[key];
}

/** 解析 imageId 的帧查询参数；无 ?frame 时无信息（返回 null 由调用方兜底） */
export function frameFromImageId(imageId: string | null | undefined): number | null {
  if (typeof imageId !== 'string' || imageId === '') {
    return null;
  }
  const frameMatch = imageId.match(/[?&]frame=(\d+)/);
  if (frameMatch) {
    const value = Number(frameMatch[1]);
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  return null;
}

/** 剥离 imageId 查询参数 → base imageId（查表键） */
export function baseImageIdOf(imageId: string): string {
  const queryIndex = imageId.indexOf('?');
  return queryIndex === -1 ? imageId : imageId.slice(0, queryIndex);
}

/** MPR 平面视口 id；轴向法线 (0,0,±1)、冠状 (0,±1,0)、矢状 (±1,0,0) */
export function planeViewportForNormal(
  normal: readonly number[] | undefined,
): string | null {
  if (
    normal === undefined ||
    normal.length < 3 ||
    !Number.isFinite(normal[0]) ||
    !Number.isFinite(normal[1]) ||
    !Number.isFinite(normal[2])
  ) {
    return null;
  }
  const x = Math.abs(normal[0] as number);
  const y = Math.abs(normal[1] as number);
  const z = Math.abs(normal[2] as number);
  if (x > 0.5) {
    return 'mpr-sagittal';
  }
  if (y > 0.5) {
    return 'mpr-coronal';
  }
  if (z > 0.5) {
    return 'mpr-axial';
  }
  return null;
}

/** 长度标注摘录 */
function describeLength(
  annotation: AnnotationLike,
): { value: number | null; unit: string | null; text: string; lines: string[] } {
  const stats = firstCachedStats(annotation);
  const length = stats?.length;
  const unit = typeof stats?.unit === 'string' ? (stats.unit as string) : undefined;
  const text = formatFixed2(typeof length === 'number' ? length : undefined, unit);
  return {
    value: typeof length === 'number' ? length : null,
    unit: unit ?? null,
    text: text !== null ? `长度 ${text}` : '长度 --',
    lines: [],
  };
}

/** 角度标注摘录（三点点位即两线段夹角；另给出两线段长度） */
function describeAngle(
  annotation: AnnotationLike,
): { value: number | null; unit: string | null; text: string; lines: string[] } {
  const stats = firstCachedStats(annotation);
  const angleValue = typeof stats?.angle === 'number' ? stats.angle : undefined;
  const points = annotation.data?.handles?.points;
  const lines: string[] = [];
  if (points !== undefined && points.length >= 3) {
    const a = points[0];
    const b = points[1];
    const c = points[2];
    lines.push(`线段 AB ${format2Point(a, b)}`);
    lines.push(`线段 BC ${format2Point(b, c)}`);
  }
  // 角度符号紧贴数值（° 不带空格），与 mm/mm² 的「数值 + 空格 + 单位」排版不同
  const base = formatFixed2(angleValue);
  return {
    value: angleValue ?? null,
    unit: '°',
    text: base !== null ? `夹角 ${base}°` : '夹角 --',
    lines,
  };
}

function format2Point(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): string {
  if (a === undefined || b === undefined) {
    return '--';
  }
  const d2 = Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0));
  return formatFixed2(d2) ?? '--';
}

/** Cobb 角标注摘录（两线段夹角 + 两段线长度；M11 任务 3） */
function describeCobbAngle(
  annotation: AnnotationLike,
): { value: number | null; unit: string | null; text: string; lines: string[] } {
  const stats = firstCachedStats(annotation);
  // 显示角优先（医学补角语义），回退内置方向无关角
  const display =
    typeof stats?.displayAngle === 'number'
      ? (stats.displayAngle as number)
      : typeof stats?.angle === 'number'
        ? (stats.angle as number)
        : undefined;
  const points = annotation.data?.handles?.points;
  const lines: string[] = [];
  if (points !== undefined && points.length >= 4) {
    const lenA = typeof stats?.lineALengthMm === 'number' ? (stats.lineALengthMm as number) : null;
    const lenB = typeof stats?.lineBLengthMm === 'number' ? (stats.lineBLengthMm as number) : null;
    lines.push(
      `线段 A ${lenA !== null ? (formatFixed2(lenA, 'mm') ?? '--') : '--'}`,
    );
    lines.push(
      `线段 B ${lenB !== null ? (formatFixed2(lenB, 'mm') ?? '--') : '--'}`,
    );
  }
  // 角度符号紧贴数值，与既有角度工具排版一致
  const base = formatFixed2(display);
  return {
    value: display ?? null,
    unit: '°',
    text: base !== null ? `夹角 ${base}°` : 'Cobb 角 --',
    lines,
  };
}

/** ROI 标注摘录（均值/标准差/最小/最大/面积 mm²/像素数，FR-5.3/5.4） */
function describeRoi(
  annotation: AnnotationLike,
): { value: number | null; unit: string | null; text: string; lines: string[] } {
  const stats = firstCachedStats(annotation);
  if (!stats) {
    return { value: null, unit: null, text: 'ROI --', lines: [] };
  }
  const area = typeof stats.area === 'number' ? stats.area : undefined;
  const areaUnit = typeof stats.areaUnit === 'string' ? (stats.areaUnit as string) : undefined;
  const mean = typeof stats.mean === 'number' ? stats.mean : undefined;
  const stdDev = typeof stats.stdDev === 'number' ? stats.stdDev : undefined;
  const min = typeof stats.min === 'number' ? stats.min : undefined;
  const max = typeof stats.max === 'number' ? stats.max : undefined;
  const count = countFromStatsArray(stats.statsArray);
  const lines: string[] = [];
  const meanText = formatFixed2(mean);
  if (meanText !== null) {
    lines.push(`均值 ${meanText}`);
  }
  const stdText = formatFixed2(stdDev);
  if (stdText !== null) {
    lines.push(`标准差 ${stdText}`);
  }
  const minText = formatFixed2(min);
  if (minText !== null) {
    lines.push(`最小 ${minText}`);
  }
  const maxText = formatFixed2(max);
  if (maxText !== null) {
    lines.push(`最大 ${maxText}`);
  }
  const areaText = formatFixed2(area, areaUnit);
  if (areaText !== null) {
    lines.push(`面积 ${areaText}`);
  }
  if (count !== null) {
    lines.push(`像素数 ${count}`);
  }
  const areaForSummary =
    area !== undefined && areaUnit !== undefined ? formatFixed2(area, areaUnit) : null;
  return {
    value: area ?? null,
    unit: areaUnit ?? null,
    text: areaForSummary !== null ? `面积 ${areaForSummary}` : meanText !== null ? `均值 ${meanText}` : 'ROI --',
    lines,
  };
}

/** 探针标注摘录（灰度值） */
function describeProbe(
  annotation: AnnotationLike,
): { value: number | null; unit: string | null; text: string; lines: string[] } {
  const stats = firstCachedStats(annotation);
  const raw = typeof stats?.index === 'object' && stats.index !== null ? undefined : stats?.value;
  const value = typeof raw === 'number' ? raw : undefined;
  const text = formatFixed2(value);
  return {
    value: value ?? null,
    unit: null,
    text: text !== null ? `灰度 ${text}` : '点标注 --',
    lines: [],
  };
}

/**
 * 生成标注面板行（FR-5.9/5.10）。
 * - 所属序列/帧：由 referencedImageId 解析；帧号取栈内序号或 ?frame=N；
 * - 所属视口：MPR 模式按 viewPlaneNormal → 平面视口；2D 按系列→视口映射；
 * - 数值：Length/Angle/ROI/Probe 从 cachedStats 摘录，双精度、显示保留 2 位小数（FR-5.13）。
 */
export function snapshotAnnotation(
  annotation: AnnotationLike,
  deps: AnnotationSnapshotDeps = {},
): AnnotationRow {
  const uid = annotation.annotationUID ?? '';
  const toolName = annotation.metadata?.toolName ?? '';
  const imageId = annotation.metadata?.referencedImageId ?? null;

  let detail: {
    value: number | null;
    unit: string | null;
    text: string;
    lines: string[];
  };
  if (toolName === 'Length') {
    detail = describeLength(annotation);
  } else if (toolName === 'Angle') {
    detail = describeAngle(annotation);
  } else if (toolName === 'CobbAngle') {
    detail = describeCobbAngle(annotation);
  } else if (toolName === 'RectangleROI' || toolName === 'EllipticalROI') {
    detail = describeRoi(annotation);
  } else if (toolName === 'Probe') {
    detail = describeProbe(annotation);
  } else {
    detail = { value: null, unit: null, text: annotationToolLabel(toolName) || '标注', lines: [] };
  }

  const resolvedSeries = imageId !== null ? deps.resolveSeries?.(imageId) ?? null : null;
  const seriesUid = resolvedSeries;

  // MPR 平面判定：法线与三主平面平行 → 对应平面视口（FR-5.15 标注归属平面）
  let isMpr = false;
  let viewportId: string | null = null;
  if (deps.mprActive) {
    const plane = planeViewportForNormal(annotation.metadata?.viewPlaneNormal);
    if (plane !== null) {
      isMpr = true;
      viewportId = plane;
    }
  }
  if (viewportId === null) {
    const viewports = seriesUid !== null ? deps.viewportsForSeries?.(seriesUid) ?? [] : [];
    viewportId = viewports.length > 0 ? (viewports[0] ?? null) : null;
  }

  let frame: number | null;
  if (isMpr && typeof annotation.metadata?.sliceIndex === 'number') {
    frame = annotation.metadata.sliceIndex + 1;
  } else if (imageId !== null) {
    const fromStack = deps.resolveFrameIndex?.(imageId);
    frame = fromStack !== null && fromStack !== undefined ? fromStack + 1 : frameFromImageId(imageId);
  } else {
    frame = null;
  }

  const spacing = imageId !== null ? deps.resolveSpacing?.(imageId) : undefined;
  const spacingRow = spacing?.[0];
  const spacingCol = spacing?.[1];
  const spacingUsable =
    spacing !== undefined &&
    typeof spacingRow === 'number' &&
    typeof spacingCol === 'number' &&
    spacingRow > 0 &&
    spacingCol > 0;

  return {
    annotationUID: uid,
    toolName,
    toolLabel: annotationToolLabel(toolName),
    seriesUid,
    viewportId,
    frame,
    imageId,
    isMpr,
    text: detail.text,
    lines: detail.lines,
    numericValue: detail.value,
    unit: detail.unit,
    isVisible: annotation.isVisible !== false,
    isSelected: annotation.isSelected === true,
    spacingUsable,
  };
}

/** 批量快照（按 系列→帧→工具 排序） */
export function snapshotAnnotations(
  annotations: readonly AnnotationLike[],
  deps: AnnotationSnapshotDeps = {},
): AnnotationRow[] {
  const rows: AnnotationRow[] = [];
  for (const annotation of annotations) {
    rows.push(snapshotAnnotation(annotation, deps));
  }
  rows.sort((a, b) => {
    const bySeries = (a.seriesUid ?? '').localeCompare(b.seriesUid ?? '');
    if (bySeries !== 0) {
      return bySeries;
    }
    const byFrame = (a.frame ?? 0) - (b.frame ?? 0);
    if (byFrame !== 0) {
      return byFrame;
    }
    const byTool =
      (TOOL_SORT_ORDER[a.toolName] ?? 99) - (TOOL_SORT_ORDER[b.toolName] ?? 99);
    if (byTool !== 0) {
      return byTool;
    }
    return (a.annotationUID ?? '').localeCompare(b.annotationUID ?? '');
  });
  return rows;
}

/** 判断一条标注是否属于指定序列（按 referencedImageId 解析） */
export function annotationBelongsToSeries(
  annotation: AnnotationLike,
  seriesUid: string,
  resolveSeries: (imageId: string) => string | null,
): boolean {
  const imageId = annotation.metadata?.referencedImageId;
  if (typeof imageId !== 'string' || imageId === '') {
    return false;
  }
  return resolveSeries(imageId) === seriesUid;
}

// ── JSON 导入导出（FR-5.11） ─────────────────────────────

export interface AnnotationExportEntry {
  annotationUID: string;
  toolName: string;
  viewportId: string | null;
  seriesUid: string | null;
  sopInstanceUid: string | null;
  frame: number | null;
  imageId: string | null;
  numericValue: number | null;
  unit: string | null;
  text: string;
  /** 完整标注对象（含坐标/句柄/统计），导入时用于恢复 */
  annotation: unknown;
}

export interface AnnotationExportFile {
  version: 1;
  exportedAt: string;
  annotations: AnnotationExportEntry[];
}

export interface SerializeAnnotationDeps {
  /** imageId → SOP Instance UID */
  resolveSop?: (imageId: string) => string | null;
  /** imageId → 序列 UID */
  resolveSeries?: (imageId: string) => string | null;
  /** seriesUid → 视口列表 */
  viewportsForSeries?: (seriesUid: string) => readonly string[];
  /** imageId → 栈内 0 基序号 */
  resolveFrameIndex?: (imageId: string) => number | null;
  /** MPR 模式是否激活 */
  mprActive?: boolean;
}

/** 标注列表 → 可导出的 JSON 文件对象（FR-5.11） */
export function toAnnotationExportFile(
  annotations: readonly AnnotationLike[],
  deps: SerializeAnnotationDeps = {},
): AnnotationExportFile {
  const rows = snapshotAnnotations(annotations, {
    resolveSeries: deps.resolveSeries,
    viewportsForSeries: deps.viewportsForSeries,
    resolveFrameIndex: deps.resolveFrameIndex,
    mprActive: deps.mprActive,
  });
  const entries: AnnotationExportEntry[] = [];
  for (const row of rows) {
    const annotation = annotations.find(
      (item) => (item.annotationUID ?? '') === row.annotationUID,
    );
    if (!annotation) {
      continue;
    }
    const sopInstanceUid =
      row.imageId !== null ? (deps.resolveSop?.(row.imageId) ?? null) : null;
    entries.push({
      annotationUID: row.annotationUID,
      toolName: row.toolName,
      viewportId: row.viewportId,
      seriesUid: row.seriesUid,
      sopInstanceUid,
      frame: row.frame,
      imageId: row.imageId,
      numericValue: row.numericValue,
      unit: row.unit,
      text: row.text,
      annotation,
    });
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    annotations: entries,
  };
}

/** JSON 文件 → 数据结构化校验；非法输入返回 null */
export function parseAnnotationExportFile(input: unknown): AnnotationExportFile | null {
  if (typeof input !== 'string') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  return validateAnnotationExportFile(parsed);
}

/** 结构化校验（FR-5.11 导入容错）：任何异常字段丢弃整条并跳过非法文件。
 *  可接受对象或 JSON 字符串；非 JSON / 版本不符 / 非对象返回 null。 */
export function validateAnnotationExportFile(input: unknown): AnnotationExportFile | null {
  if (typeof input === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return null;
    }
    return validateAnnotationExportFile(parsed);
  }
  if (input === null || typeof input !== 'object') {
    return null;
  }
  const source = input as { version?: unknown; exportedAt?: unknown; annotations?: unknown };
  if (source.version !== 1) {
    return null;
  }
  if (!Array.isArray(source.annotations)) {
    return null;
  }
  const annotations: AnnotationExportEntry[] = [];
  for (const entry of source.annotations) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const item = entry as Partial<AnnotationExportEntry>;
    if (typeof item.toolName !== 'string' || typeof item.annotationUID !== 'string') {
      continue;
    }
    annotations.push({
      annotationUID: item.annotationUID,
      toolName: item.toolName,
      viewportId: typeof item.viewportId === 'string' ? item.viewportId : null,
      seriesUid: typeof item.seriesUid === 'string' ? item.seriesUid : null,
      sopInstanceUid: typeof item.sopInstanceUid === 'string' ? item.sopInstanceUid : null,
      frame: typeof item.frame === 'number' ? item.frame : null,
      imageId: typeof item.imageId === 'string' ? item.imageId : null,
      numericValue: typeof item.numericValue === 'number' ? item.numericValue : null,
      unit: typeof item.unit === 'string' ? item.unit : null,
      text: typeof item.text === 'string' ? item.text : '',
      annotation: item.annotation,
    });
  }
  return {
    version: 1,
    exportedAt: typeof source.exportedAt === 'string' ? source.exportedAt : '',
    annotations,
  };
}

/** 导出 JSON 字符串（缩进便于人工审查） */
export function serializeAnnotationsJson(file: AnnotationExportFile): string {
  return JSON.stringify(file, null, 2);
}

/** 遍历标注集合的鸭子类型迭代器 */
export function asAnnotationList(list: unknown): AnnotationLike[] {
  return Array.isArray(list)
    ? list.filter((item): item is AnnotationLike => item !== null && typeof item === 'object')
    : [];
}