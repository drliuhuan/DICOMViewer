/**
 * 标注清理与解析器构建（FR-5.10，M10-D）。
 *
 * - cornerstone 标注按 referencedImageId 绑定帧；序列关闭/清空时按
 *   「referencedImageId 归属序列」清理，避免孤儿标注（FR-5.10）；
 * - 解析器（imageId → 序列/帧号/SOP/间距 + seriesUid → 视口）由已加载序列
 *   栈与应用映射构建，供面板快照与清理复用。
 *
 * 纯逻辑，注入标注状态操作（tests 可传 fake）。
 */
import { baseImageIdOf } from './annotationModel';
import type { AnnotationLike } from './annotationModel';

/** 已加载堆栈的最小结构（SeriesStack 子集，测试可构造） */
export interface StackLike {
  seriesUid: string;
  items: Array<{
    imageId: string;
    summary?: {
      sopInstanceUid?: string;
      sopClassUid?: string;
      pixelSpacing?: readonly number[];
    };
  }>;
}

export interface ResolverInput {
  stacks: readonly StackLike[];
  /** 视口 id → 已加载序列 UID（null = 空视口） */
  assignments: Record<string, string | null>;
}

export interface AnnotationResolvers {
  resolveSeries: (imageId: string) => string | null;
  resolveFrameIndex: (imageId: string) => number | null;
  resolveSop: (imageId: string) => string | null;
  resolveSopClass: (imageId: string) => string | null;
  resolveSpacing: (imageId: string) => readonly number[] | undefined;
  viewportsForSeries: (seriesUid: string) => readonly string[];
}

/**
 * 由已加载堆栈构建标注解析器：
 * - imageId（含帧查询）→ 序列：按 base imageId 查表（多帧逐帧 imageId 共享 base）；
 * - 帧号：base imageId 在栈 items 中的 0 基序号（数组序 = 渲染序）；
 * - SOP/间距：来自条目 summary。
 */
export function buildAnnotationResolvers(input: ResolverInput): AnnotationResolvers {
  const seriesByBaseImageId = new Map<string, string>();
  const frameIndexByBaseImageId = new Map<string, number>();
  const sopByBaseImageId = new Map<string, string>();
  const sopClassByBaseImageId = new Map<string, string>();
  const spacingByBaseImageId = new Map<string, readonly number[]>();

  for (const stack of input.stacks) {
    stack.items.forEach((item, index) => {
      const base = baseImageIdOf(item.imageId);
      if (!seriesByBaseImageId.has(base)) {
        seriesByBaseImageId.set(base, stack.seriesUid);
        frameIndexByBaseImageId.set(base, index);
      }
      if (item.summary?.sopInstanceUid !== undefined) {
        sopByBaseImageId.set(base, item.summary.sopInstanceUid);
      }
      if (item.summary?.sopClassUid !== undefined) {
        sopClassByBaseImageId.set(base, item.summary.sopClassUid);
      }
      if (item.summary?.pixelSpacing !== undefined) {
        spacingByBaseImageId.set(base, item.summary.pixelSpacing);
      }
    });
  }

  const viewportsBySeries = new Map<string, string[]>();
  for (const [viewportId, seriesUid] of Object.entries(input.assignments)) {
    if (seriesUid === null) {
      continue;
    }
    const list = viewportsBySeries.get(seriesUid) ?? [];
    list.push(viewportId);
    viewportsBySeries.set(seriesUid, list);
  }

  const byBase = (imageId: string): string | null => {
    if (typeof imageId !== 'string' || imageId === '') {
      return null;
    }
    return seriesByBaseImageId.get(baseImageIdOf(imageId)) ?? null;
  };

  return {
    resolveSeries: byBase,
    resolveFrameIndex: (imageId) => {
      if (typeof imageId !== 'string' || imageId === '') {
        return null;
      }
      const index = frameIndexByBaseImageId.get(baseImageIdOf(imageId));
      return index === undefined ? null : index;
    },
    resolveSop: (imageId) => {
      if (typeof imageId !== 'string' || imageId === '') {
        return null;
      }
      return sopByBaseImageId.get(baseImageIdOf(imageId)) ?? null;
    },
    resolveSopClass: (imageId) => {
      if (typeof imageId !== 'string' || imageId === '') {
        return null;
      }
      return sopClassByBaseImageId.get(baseImageIdOf(imageId)) ?? null;
    },
    resolveSpacing: (imageId) => {
      if (typeof imageId !== 'string' || imageId === '') {
        return undefined;
      }
      return spacingByBaseImageId.get(baseImageIdOf(imageId));
    },
    viewportsForSeries: (seriesUid) => viewportsBySeries.get(seriesUid) ?? [],
  };
}

/** 标注状态操作接口（真实实现 = @cornerstonejs/tools state；测试可传 fake） */
export interface AnnotationStateOps {
  getAllAnnotations: () => readonly AnnotationLike[];
  /** 删除单个标注；返回是否实际删除 */
  removeAnnotation: (annotationUID: string) => boolean;
  /** 恢复导入的标注（annotation + 归属选择器）；可选（导入功能专用） */
  addAnnotation?: (
    annotation: unknown,
    annotationGroupSelector: unknown,
  ) => string | void;
}

/**
 * 删除指定序列产生的全部标注（FR-5.10 序列关闭时清理）。
 * @returns 删除的标注数
 */
export function removeAnnotationsForSeries(
  seriesUid: string,
  ops: AnnotationStateOps,
  resolveSeries: (imageId: string) => string | null,
): number {
  let removed = 0;
  for (const annotation of ops.getAllAnnotations()) {
    const imageId = annotation.metadata?.referencedImageId;
    if (typeof imageId !== 'string' || imageId === '') {
      continue;
    }
    if (resolveSeries(imageId) === seriesUid) {
      const uid = annotation.annotationUID ?? '';
      if (uid !== '') {
        if (ops.removeAnnotation(uid)) {
          removed += 1;
        }
      }
    }
  }
  return removed;
}

/** 删除多个序列产生的标注（`removeAnnotationsForSeries` 的批量版） */
export function removeAnnotationsForSeriesList(
  seriesUids: readonly string[],
  ops: AnnotationStateOps,
  resolveSeries: (imageId: string) => string | null,
): number {
  const target = new Set(seriesUids.filter((uid) => typeof uid === 'string' && uid !== ''));
  if (target.size === 0) {
    return 0;
  }
  let removed = 0;
  for (const annotation of ops.getAllAnnotations()) {
    const imageId = annotation.metadata?.referencedImageId;
    if (typeof imageId !== 'string' || imageId === '') {
      continue;
    }
    const series = resolveSeries(imageId);
    if (series !== null && target.has(series)) {
      const uid = annotation.annotationUID ?? '';
      if (uid !== '' && ops.removeAnnotation(uid)) {
        removed += 1;
      }
    }
  }
  return removed;
}

/** 清空全部标注（FR-5.9 清空 / FR-2.9 清空全部数据时调用） */
export function clearAllAnnotations(ops: AnnotationStateOps): number {
  let removed = 0;
  for (const annotation of ops.getAllAnnotations()) {
    const uid = annotation.annotationUID ?? '';
    if (uid !== '') {
      if (ops.removeAnnotation(uid)) {
        removed += 1;
      }
    }
  }
  return removed;
}