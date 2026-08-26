/**
 * M10-D 标注数据模型（FR-5.9/5.10/5.11）：快照行/帧关联/MPR 平面/JSON 往返。
 */
import { describe, expect, it } from 'vitest';
import {
  snapshotAnnotation,
  snapshotAnnotations,
  toAnnotationExportFile,
  serializeAnnotationsJson,
  parseAnnotationExportFile,
  validateAnnotationExportFile,
  frameFromImageId,
  planeViewportForNormal,
  type AnnotationLike,
} from '../src/features/measure/annotationModel';
import { buildAnnotationResolvers } from '../src/features/measure/annotationCleanup';

const depsBase = {
  resolveSeries: (imageId: string) => (imageId.includes('key-1') ? '1.2.s1' : '1.2.s2'),
  viewportsForSeries: (seriesUid: string) => (seriesUid === '1.2.s1' ? ['vp-0'] : ['vp-1']),
  resolveFrameIndex: (imageId: string) =>
    imageId.includes('key-1') ? 0 : imageId.includes('key-2') ? 1 : null,
  resolveSop: (imageId: string) =>
    imageId.includes('key-1') ? '1.2.sop1' : imageId.includes('key-2') ? '1.2.sop2' : null,
  resolveSpacing: () => [0.5, 0.5] as [number, number],
};

function lengthAnnotation(overrides: Partial<AnnotationLike> = {}): AnnotationLike {
  return {
    annotationUID: 'uid-1',
    metadata: { toolName: 'Length', referencedImageId: 'dcm-file://key-1' },
    data: {
      handles: { points: [[0, 0, 0], [20, 0, 0]] },
      cachedStats: {
        target: { length: 20, unit: 'px' },
      },
    },
    ...overrides,
  };
}

describe('snapshotAnnotation（FR-5.9 面板行）', () => {
  it('长度标注：类型/数值/单位/所属序列与视口', () => {
    const row = snapshotAnnotation(lengthAnnotation(), depsBase);
    expect(row.toolLabel).toBe('长度');
    expect(row.text).toBe('长度 20 px');
    expect(row.numericValue).toBe(20);
    expect(row.unit).toBe('px');
    expect(row.seriesUid).toBe('1.2.s1');
    expect(row.viewportId).toBe('vp-0');
    expect(row.frame).toBe(1);
    expect(row.isMpr).toBe(false);
    expect(row.spacingUsable).toBe(true);
  });

  it('角度标注：夹角数值 + 两线段长度（FR-5.2）', () => {
    const row = snapshotAnnotation(
      {
        annotationUID: 'uid-a',
        metadata: { toolName: 'Angle', referencedImageId: 'dcm-file://key-1' },
        data: {
          handles: { points: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] },
          cachedStats: { target: { angle: 45 } },
        },
      },
      depsBase,
    );
    expect(row.text).toBe('夹角 45°');
    expect(row.lines[0]).toBe('线段 AB 10');
    expect(row.lines[1]).toBe('线段 BC 10');
  });

  it('矩形 ROI：均值/标准差/最小/最大/面积/像素数', () => {
    const row = snapshotAnnotation(
      {
        annotationUID: 'uid-r',
        metadata: { toolName: 'RectangleROI', referencedImageId: 'dcm-file://key-1' },
        data: {
          handles: { points: [[0, 0, 0], [4, 4, 0]] },
          cachedStats: {
            target: {
              area: 12,
              areaUnit: 'mm²',
              mean: 10.5,
              stdDev: 2.25,
              min: 1,
              max: 20,
              statsArray: [{ name: 'count', value: 25 }],
            },
          },
        },
      },
      depsBase,
    );
    expect(row.text).toBe('面积 12 mm²');
    expect(row.lines).toContain('均值 10.5');
    expect(row.lines).toContain('标准差 2.25');
    expect(row.lines).toContain('最小 1');
    expect(row.lines).toContain('最大 20');
    expect(row.lines).toContain('像素数 25');
  });

  it('帧号：单帧每文件按栈内序号；多帧按 ?frame=N（FR-5.10）', () => {
    const stackRow = snapshotAnnotation(
      lengthAnnotation({
        annotationUID: 'uid2',
        metadata: { toolName: 'Length', referencedImageId: 'dcm-file://key-2' },
      }),
      depsBase,
    );
    expect(stackRow.frame).toBe(2);

    const multiframeRow = snapshotAnnotation(
      lengthAnnotation({
        annotationUID: 'uid3',
        metadata: {
          toolName: 'Length',
          referencedImageId: 'dcm-file://key-1?frame=3',
        },
      }),
      { ...depsBase, resolveFrameIndex: () => null },
    );
    expect(multiframeRow.frame).toBe(3);
  });

  it('MPR 标注：viewPlaneNormal → 平面视口，sliceIndex → 帧（FR-5.15）', () => {
    const row = snapshotAnnotation(
      lengthAnnotation({
        metadata: {
          toolName: 'Length',
          referencedImageId: 'dcm-file://key-1',
          sliceIndex: 7,
          viewPlaneNormal: [0, 0, 1],
        },
      }),
      { ...depsBase, mprActive: true },
    );
    expect(row.isMpr).toBe(true);
    expect(row.viewportId).toBe('mpr-axial');
    expect(row.frame).toBe(8);
  });

  it('间距缺失 → spacingUsable=false，供界面显示（无间距）提示（FR-5.8）', () => {
    const row = snapshotAnnotation(lengthAnnotation(), {
      ...depsBase,
      resolveSpacing: () => undefined,
    });
    expect(row.spacingUsable).toBe(false);
  });
});

describe('frameFromImageId / planeViewportForNormal', () => {
  it('帧解析', () => {
    expect(frameFromImageId('dcm-file://k')).toBeNull();
    expect(frameFromImageId('dcm-file://k?frame=1')).toBe(1);
    expect(frameFromImageId('dcm-file://k?frame=12')).toBe(12);
    expect(frameFromImageId('dcm-file://k&frame=3')).toBe(3);
    expect(frameFromImageId(null)).toBeNull();
  });

  it('平面判定', () => {
    expect(planeViewportForNormal([0, 0, 1])).toBe('mpr-axial');
    expect(planeViewportForNormal([0, 1, 0])).toBe('mpr-coronal');
    expect(planeViewportForNormal([1, 0, 0])).toBe('mpr-sagittal');
    expect(planeViewportForNormal([0.5, 0.5, 0])).toBeNull();
    expect(planeViewportForNormal(undefined)).toBeNull();
  });
});

describe('JSON 导入导出（FR-5.11）', () => {
  it('序列化 → 反序列化往返一致（含 SOP/帧/值/单位/完整标注）', () => {
    const annotations: AnnotationLike[] = [
      lengthAnnotation(),
      {
        annotationUID: 'uid-e',
        metadata: { toolName: 'EllipticalROI', referencedImageId: 'dcm-file://key-1' },
        data: {
          handles: { points: [[0, 0, 0], [4, 4, 0]] },
          cachedStats: { target: { area: 314, areaUnit: 'mm²', mean: 5 } },
        },
      },
    ];
    const file = toAnnotationExportFile(annotations, depsBase);
    const json = serializeAnnotationsJson(file);
    const parsed = parseAnnotationExportFile(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.annotations).toHaveLength(2);
    const length = parsed!.annotations.find((e) => e.toolName === 'Length');
    expect(length?.sopInstanceUid).toBe('1.2.sop1');
    expect(length?.seriesUid).toBe('1.2.s1');
    expect(length?.frame).toBe(1);
    expect(length?.numericValue).toBe(20);
    expect(length?.unit).toBe('px');
    expect(length?.annotation).toMatchObject({ annotationUID: 'uid-1' });

    const ellipse = parsed!.annotations.find((e) => e.toolName === 'EllipticalROI');
    expect(ellipse?.numericValue).toBe(314);
    expect(ellipse?.unit).toBe('mm²');
  });

  it('非法输入返回 null（非 JSON / 版本不符 / 非对象）', () => {
    expect(parseAnnotationExportFile('not json')).toBeNull();
    expect(validateAnnotationExportFile({ version: 2, annotations: [] })).toBeNull();
    expect(validateAnnotationExportFile(null)).toBeNull();
    expect(validateAnnotationExportFile('{"version":1,"annotations":[1]}')).not.toBeNull();
  });

  it('批量快照按 系列→帧→工具 排序', () => {
    const rows = snapshotAnnotations(
      [
        lengthAnnotation({
          annotationUID: 'z',
          metadata: { toolName: 'Length', referencedImageId: 'dcm-file://key-2' },
        }),
        lengthAnnotation({
          annotationUID: 'a',
          metadata: { toolName: 'Length', referencedImageId: 'dcm-file://key-1' },
        }),
        {
          annotationUID: 'b',
          metadata: { toolName: 'Angle', referencedImageId: 'dcm-file://key-1' },
          data: { handles: { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }, cachedStats: { t: { angle: 90 } } },
        },
      ],
      depsBase,
    );
    expect(rows.map((r) => r.annotationUID)).toEqual(['a', 'b', 'z']);
  });
});

describe('buildAnnotationResolvers（FR-5.10 关联解析）', () => {
  function stack(seriesUid: string, imageIds: string[]) {
    return {
      seriesUid,
      items: imageIds.map((imageId, index) => ({
        imageId,
        summary: {
          sopInstanceUid: `sop:${seriesUid}:${index}`,
          sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
          pixelSpacing: [0.7, 0.7] as [number, number],
        },
      })),
    };
  }

  it('imageId（含帧查询）→ 序列/栈内序号/SOP/间距/视口', () => {
    const resolvers = buildAnnotationResolvers({
      stacks: [
        stack('1.2.s1', ['dcm-file://k1', 'dcm-file://k2']),
        stack('1.2.s2', ['dcm-file://k9']),
      ],
      assignments: { 'vp-0': '1.2.s1', 'vp-1': '1.2.s2', 'vp-2': null },
    });
    expect(resolvers.resolveSeries('dcm-file://k1?frame=2')).toBe('1.2.s1');
    expect(resolvers.resolveFrameIndex('dcm-file://k2')).toBe(1);
    expect(resolvers.resolveSop('dcm-file://k1')).toBe('sop:1.2.s1:0');
    expect(resolvers.resolveSopClass('dcm-file://k2')).toBe('1.2.840.10008.5.1.4.1.1.2');
    expect(resolvers.resolveSpacing('dcm-file://k1')).toEqual([0.7, 0.7]);
    expect(resolvers.viewportsForSeries('1.2.s1')).toEqual(['vp-0']);
    expect(resolvers.resolveSeries('dcm-file://unknown')).toBeNull();
  });
});