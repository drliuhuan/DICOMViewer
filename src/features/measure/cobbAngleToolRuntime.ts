/**
 * Cobb 角工具运行时装载（M11 任务 3）。
 *
 * @cornerstonejs/tools 5.8.2 内置 `CobbAngleTool`（toolName='CobbAngle'）：
 * 两段式拖拽交互——第一次按下/拖动/抬起完成线段 A，再次按下拖动后
 * 抬起完成线段 B；与既有 AngleTool 的 AnnotationTool 状态机一致，
 * 支持端点句柄拖拽微调与选中删除。
 *
 * 内置工具仅输出 θ（方向无关角）与圆弧角度，缺两段线的物理长度。
 * 这里在其之上构造子类：
 * - `_calculateCachedStats` 委托父类后追加 lineALengthMm / lineBLengthMm /
 *   displayAngle（world 坐标距离即 patient 空间 mm）；
 * - 默认 textLines 覆盖为 [θ°, A 长度, B 长度] 三行。
 *
 * 为避免模块顶层依赖 cornerstone（Node 单测环境安全），基类经动态
 * import 注入工厂函数 createCobbAngleWithStats；注册入口在 toolSetup
 * 初始化时惰性调用 loadCobbAngleTool。任何失败返回 null 并降级为
 * 「不提供 Cobb 工具」，不影响其它测量工具。
 */
import {
  computeCobbSegmentStats,
} from './cobbGeometry';
import { formatFixed2 } from './roiStats';

/** 最小基类契约（真实实现=cornerstone CobbAngleTool；测试可注入桩） */
export interface CobbBaseInstance {
  configuration: {
    getTextLines?: (
      data: CobbDataLike,
      targetId: string,
    ) => string[] | undefined;
  };
  _calculateCachedStats?(
    annotation: CobbnAnnotationLike,
    renderingEngine?: unknown,
    enabledElement?: unknown,
  ): unknown;
}

export type CobbBaseCtor = new (
  toolProps?: unknown,
  defaultToolProps?: unknown,
) => CobbBaseInstance;

export interface CobbHandlesLike {
  points?: Array<number[] | readonly number[]>;
  textBox?: unknown;
  activeHandleIndex?: number | string | null;
}

export interface CobbDataLike {
  handles?: CobbHandlesLike;
  cachedStats?: Record<string, Record<string, unknown>>;
}

export interface CobbnAnnotationLike {
  annotationUID?: string;
  data?: CobbDataLike;
  invalidated?: boolean;
  highlighted?: boolean;
  metadata?: { toolName?: string };
}

/**
 * 把两段线长度与显示角并入目标 cachedStats 条目
 * （true=发生了写入）。点数不足或统计缺失时保持原样。
 */
export function enrichCobbStatsEntry(
  entry: Record<string, unknown> | undefined,
  points: ReadonlyArray<readonly number[]> | undefined,
): boolean {
  if (!entry) {
    return false;
  }
  const stats = computeCobbSegmentStats(points);
  if (stats.displayAngle === null && stats.lineALengthMm === null) {
    return false;
  }
  if (stats.lineALengthMm !== null) {
    entry['lineALengthMm'] = stats.lineALengthMm;
    entry['lineBLengthMm'] = stats.lineBLengthMm;
  }
  if (stats.displayAngle !== null) {
    entry['displayAngle'] = stats.displayAngle;
  }
  return true;
}

/** Cobb 标注的图上文字：θ° + 两段线 mm（供面板/画布共用语义） */
export function cobbTextLines(
  data: CobbDataLike | undefined,
  targetId: string | undefined,
): string[] | undefined {
  const entry =
    data?.cachedStats && targetId !== undefined ? data.cachedStats[targetId] : undefined;
  const rawAngle =
    typeof entry?.displayAngle === 'number'
      ? (entry.displayAngle as number)
      : typeof entry?.angle === 'number'
        ? (entry.angle as number)
        : null;
  if (rawAngle === null) {
    return undefined; // 中间态不写文字（与内置行为一致）
  }
  const lines = [`${rawAngle.toFixed(2)} °`];
  for (const key of ['lineALengthMm', 'lineBLengthMm'] as const) {
    const value = entry?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const text = formatFixed2(value, 'mm');
      if (text !== null) {
        lines.push(text);
      }
    }
  }
  return lines;
}

/**
 * 以给定基类构造增强版 Cobb 工具类。
 * 与内置 AngleTool 行为对齐：继承其 addNewAnnotation/_dragCallback/
 * _endCallback/_mouseDownCallback/isPointNearTool/handleSelectedCallback
 * 全部状态机，仅在统计计算收尾处做富集。
 */
export function createCobbAngleWithStats(
  Base: CobbBaseCtor,
): CobbBaseCtor {
  const Enhanced = class extends Base {
    constructor(toolProps?: unknown, defaultToolProps?: unknown) {
      super(toolProps, defaultToolProps);
      this.configuration.getTextLines = (data, targetId) => {
        const lines = cobbTextLines(data, targetId);
        if (lines !== undefined && lines.length > 0) {
          return lines;
        }
        return undefined; // 中间态不写文字（与内置行为一致）
      };
    }

    override _calculateCachedStats(
      annotation: CobbnAnnotationLike,
      renderingEngine?: unknown,
      enabledElement?: unknown,
    ): unknown {
      const result = super._calculateCachedStats?.(
        annotation,
        renderingEngine,
        enabledElement,
      );
      try {
        const data = annotation.data;
        const stats = data?.cachedStats;
        if (stats && data?.handles?.points) {
          for (const key of Object.keys(stats)) {
            enrichCobbStatsEntry(stats[key], data.handles.points);
          }
        }
      } catch {
        // 富集失败不影响内置统计
      }
      return result;
    }
  };
  return Enhanced as unknown as CobbBaseCtor;
}

let loadedClassPromise: Promise<CobbBaseCtor | null> | null = null;

/**
 * 惰性装载真实 cornerstone CobbAngleTool 并构造增强子类；
 * 不可用时 resolve null（mock 环境/包缺失），绝不抛错阻断启动。
 */
export function loadCobbAngleTool(): Promise<CobbBaseCtor | null> {
  loadedClassPromise ??= (async () => {
    try {
      const tools = await import('@cornerstonejs/tools');
      const candidates = [
        (tools as Record<string, unknown>)['CobbAngleTool'],
        ((tools as Record<string, unknown>).default as Record<string, unknown> | undefined)?.[
          'CobbAngleTool'
        ],
      ];
      const Base = candidates.find((item) => typeof item === 'function');
      if (Base === undefined) {
        return null;
      }
      return createCobbAngleWithStats(Base as CobbBaseCtor);
    } catch {
      return null;
    }
  })();
  return loadedClassPromise;
}
