/**
 * M11 任务 3：Cobb 角工具运行时——与既有 AngleTool（AnnotationTool 状态机）
 * 行为对齐的交互测试（基类可注入，模拟 cornerstone 环境）。
 *
 * 覆盖：
 * - 子类继承内置 CobbAngleTool 的两段式交互钩子（addNewAnnotation/
 *   _mouseDownCallback/_dragCallback/_endCallback/isPointNearTool/
 *   handleSelectedCallback/cancel/renderAnnotation 均来自基类原型）；
 * - _calculateCachedStats 委托父类后追加 lineALengthMm/lineBLengthMm/displayAngle；
 * - 默认 getTextLines 输出 θ° + 两段线长度；
 * - loadCobbAngleTool 在无 cornerstone（mock/缺失）环境安全降级为 null。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@cornerstonejs/tools', () => ({}));

import {
  createCobbAngleWithStats,
  cobbTextLines,
  enrichCobbStatsEntry,
  type CobbnAnnotationLike,
} from '../src/features/measure/cobbAngleToolRuntime';
import { loadCobbAngleTool } from '../src/features/measure/cobbAngleToolRuntime';

/** 模拟内置 CobbAngleTool 的最小行为面：仅统计计算写 {angle}，其余钩子原样继承 */
class FakeCornerstoneCobbBase {
  static toolName = 'CobbAngle';
  configuration: {
    getTextLines?: (
      data: Parameters<typeof cobbTextLines>[0],
      targetId: string,
    ) => string[] | undefined;
  } = {};

  constructor(toolProps?: unknown, defaultToolProps?: unknown) {
    void toolProps;
    if (
      defaultToolProps &&
      typeof defaultToolProps === 'object' &&
      'configuration' in (defaultToolProps as Record<string, unknown>)
    ) {
      const configuration = (defaultToolProps as { configuration?: Record<string, unknown> })
        .configuration;
      if (configuration) {
        Object.assign(this.configuration, configuration);
      }
    }
    // 两段式交互状态机钩子（真实实现由内置类提供；此处验证子类确实继承）
    this.addNewAnnotation = this.addNewAnnotation.bind(this);
  }

  addNewAnnotation(_evt: unknown): unknown {
    return { stage: 'started' };
  }

  isPointNearTool(): boolean {
    return true;
  }

  handleSelectedCallback(): void {
    /* 继承断言用桩 */
  }

  cancel(): string | undefined {
    return 'cancelled';
  }

  /** 与内置实现同构：向每个 targetId 写入方向无关角 */
  _calculateCachedStats(
    annotation: CobbnAnnotationLike,
    _renderingEngine?: unknown,
    _enabledElement?: unknown,
  ): unknown {
    const stats = annotation.data?.cachedStats ?? {};
    for (const key of Object.keys(stats)) {
      stats[key] = { ...stats[key], angle: 42 };
    }
    return stats;
  }
}

function makeAnnotation(points: number[][]): CobbnAnnotationLike {
  return {
    annotationUID: 'cobb-1',
    data: {
      handles: { points },
      cachedStats: { 'target-id': {} },
    },
  };
}

describe('createCobbAngleWithStats（Cobb 工具增强）', () => {
  it('继承两段式交互状态机与选中/取消钩子', () => {
    const Enhanced = createCobbAngleWithStats(FakeCornerstoneCobbBase);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance: any = new Enhanced();
    expect(instance.addNewAnnotation({ detail: {} })).toEqual({ stage: 'started' });
    expect(instance.isPointNearTool()).toBe(true);
    expect(typeof instance.handleSelectedCallback).toBe('function');
    expect(instance.cancel()).toBe('cancelled');
    expect(instance instanceof FakeCornerstoneCobbBase).toBe(true);
    expect(FakeCornerstoneCobbBase.toolName).toBe('CobbAngle');
  });

  it('_calculateCachedStats 先执行内置角计算再追加长度与显示角', () => {
    const Enhanced = createCobbAngleWithStats(FakeCornerstoneCobbBase);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance: any = new Enhanced();
    const annotation = makeAnnotation([
      [0, 0, 0],
      [10, 0, 0],
      [20, 20, 0],
      [20, 50, 0],
    ]);
    instance._calculateCachedStats(annotation);
    const entry = annotation.data!.cachedStats!['target-id']!;
    expect(entry['angle']).toBe(42);
    expect(entry['displayAngle']).toBeCloseTo(90, 6);
    expect(entry['lineALengthMm']).toBeCloseTo(10, 6);
    expect(entry['lineBLengthMm']).toBeCloseTo(30, 6);
  });

  it('默认 getTextLines 输出 θ° + 两段线长度三行；缺统计时回退 undefined', () => {
    const Enhanced = createCobbAngleWithStats(FakeCornerstoneCobbBase);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instance: any = new Enhanced();
    const annotation = makeAnnotation([
      [0, 0, 0],
      [10, 0, 0],
      [20, 20, 0],
      [20, 50, 0],
    ]);
    instance._calculateCachedStats(annotation);
    const lines = instance.configuration.getTextLines?.(
      annotation.data!,
      'target-id',
    );
    expect(lines).toEqual(['90.00 °', '10 mm', '30 mm']);

    // 无任何统计 → 不写文字（中间态）
    expect(cobbTextLines(undefined, undefined)).toBeUndefined();
    expect(cobbTextLines({ cachedStats: {} }, 'x')).toBeUndefined();
  });

  it('enrichCobbStatsEntry 对空条目/点数不足保持 false 且不抛错', () => {
    expect(enrichCobbStatsEntry(undefined, [[0, 0]])).toBe(false);
    expect(enrichCobbStatsEntry({}, [[0, 0], [1, 0]])).toBe(false); // 少于4点
  });
});

describe('loadCobbAngleTool 降级路径', () => {
  it('@cornerstonejs/tools 未导出 CobbAngleTool 时 resolve null（不阻断启动）', async () => {
    const loaded = await loadCobbAngleTool();
    expect(loaded).toBeNull();
    expect(vi.isMockFunction(() => undefined) || true).toBe(true);
  });
});
