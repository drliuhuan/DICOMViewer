/**
 * M11 任务 3：Cobb 角接入既有测量体系——面板快照 + JSON 导出结构 +
 * DICOM SR（TID1419 Angle 通道折算）。
 */
import { describe, expect, it } from 'vitest';
import {
  snapshotAnnotation,
  toAnnotationExportFile,
  type AnnotationLike,
} from '../src/features/measure/annotationModel';
import {
  SR_TOOL_TYPE_MAP,
  annotationToV4Measurement,
} from '../src/features/measure/srExport';

function cobbAnnotation(): AnnotationLike {
  return {
    annotationUID: 'cobb-a',
    metadata: {
      toolName: 'CobbAngle',
      referencedImageId: 'dcm-file://k1',
      viewPlaneNormal: [0, 0, 1],
    },
    data: {
      handles: {
        points: [
          [-10, 5, 0],
          [1, 5, 0],
          [3, -8, 0],
          [3, 9, 0],
        ],
      },
      cachedStats: {
        target1: {
          angle: 90,
          displayAngle: 90,
          lineALengthMm: 11,
          lineBLengthMm: 17,
        },
      },
    },
    isVisible: true,
  };
}

describe('SR_TOOL_TYPE_MAP（Cobb 沿用 Angle 通道）', () => {
  it('CobbAngle 映射为 dcmjs Angle 类型', () => {
    expect(SR_TOOL_TYPE_MAP['CobbAngle']).toBe('Angle');
    // 不改变既有映射
    expect(SR_TOOL_TYPE_MAP['Length']).toBe('Length');
    expect(SR_TOOL_TYPE_MAP['RectangleROI']).toBe('RectangleRoi');
  });
});

describe('annotationToV4Measurement（Cobb → 三点半角）', () => {
  it('相交两线折算 start/middle/end，rAngle 取显示角', () => {
    const measurement = annotationToV4Measurement(cobbAnnotation()) as {
      handles: { start: { x: number; y: number }; middle: { x: number; y: number }; end: { x: number; y: number } };
      rAngle: number;
    };
    // 交点 = (3,5)；A 线远端 (-10,5)；B 线远端 (3,-8)
    expect(measurement.handles.start).toEqual({ x: -10, y: 5 });
    expect(measurement.handles.middle).toEqual({ x: 3, y: 5 });
    expect(measurement.handles.end).toEqual({ x: 3, y: -8 });
    expect(measurement.rAngle).toBe(90);
  });

  it('平行线无交点 → 返回 null（跳过该条）', () => {
    const annotation = cobbAnnotation();
    const points = annotation.data!.handles!.points as number[][];
    points.splice(2, 4, [0, 1], [1, 1]); // 平行于 A
    delete (annotation.data!.cachedStats!.target1 as Record<string, unknown>)['displayAngle'];
    (annotation.data!.cachedStats!.target1 as Record<string, unknown>)['angle'] = 0;
    expect(annotationToV4Measurement(annotation)).toBeNull();
  });

  it('无统计（绘制中间态）→ null', () => {
    const annotation = cobbAnnotation();
    annotation.data!.cachedStats = {};
    expect(annotationToV4Measurement(annotation)).toBeNull();
  });
});

describe('面板与 JSON 导出（Cobb 行）', () => {
  it('snapshotAnnotation 输出 Cobb 角标签、显示角文本与两段线明细', () => {
    const row = snapshotAnnotation(cobbAnnotation(), {
      resolveSeries: () => '1.2.s',
      viewportsForSeries: () => ['vp-0'],
      resolveFrameIndex: () => 0,
      resolveSpacing: () => [0.5, 0.5],
    });
    expect(row.toolLabel).toBe('Cobb 角');
    expect(row.text).toContain('夹角');
    expect(row.text).toContain('°');
    expect(row.unit).toBe('°');
    expect(row.numericValue).toBe(90);
    expect(row.lines.join('\n')).toContain('线段 A 11 mm');
    expect(row.lines.join('\n')).toContain('线段 B 17 mm');
  });

  it('toAnnotationExportFile 包含 Cobb 条目（toolName 原样保留）', () => {
    const file = toAnnotationExportFile([cobbAnnotation()], {
      resolveSeries: () => '1.2.s',
      viewportsForSeries: () => ['vp-0'],
      resolveFrameIndex: () => 0,
    });
    expect(file.annotations).toHaveLength(1);
    expect(file.annotations[0]?.toolName).toBe('CobbAngle');
    expect(file.annotations[0]?.numericValue).toBe(90);
  });
});
