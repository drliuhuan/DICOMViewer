/**
 * M10-D DICOM SR 导出（FR-5.12）：V4 映射 + Part-10 生成 + dcmjs 回读验证。
 */
import { describe, expect, it } from 'vitest';
import { data } from 'dcmjs';
import {
  annotationToV4Measurement,
  buildMeasurementSr,
  readSrInfo,
  SR_SOP_CLASS_UID,
  SR_TOOL_TYPE_MAP,
  createSrMetadataProvider,
} from '../src/features/measure/srExport';
import type { AnnotationLike } from '../src/features/measure/annotationModel';

function lengthAnnotation(overrides: Partial<AnnotationLike> = {}): AnnotationLike {
  return {
    annotationUID: 'u-len',
    metadata: { toolName: 'Length', referencedImageId: 'dcm-file://k1' },
    data: {
      handles: { points: [[0, 0, 0], [10, 5, 0]] },
      cachedStats: { target: { length: 5.125, unit: 'mm' } },
    },
    ...overrides,
  };
}

function roiAnnotation(toolName = 'RectangleROI'): AnnotationLike {
  return {
    annotationUID: 'u-roi',
    metadata: { toolName, referencedImageId: 'dcm-file://k1' },
    data: {
      handles: { points: [[0, 0, 0], [10, 10, 0]] },
      cachedStats: { target: { area: 100, areaUnit: 'mm²', mean: 5 } },
    },
  };
}

const resolver = {
  resolveSop: () => ({
    sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
    sopInstanceUID: '1.2.88',
    frame: 1,
  }),
  resolveSeries: () => ({
    studyInstanceUID: '1.2.study',
    seriesInstanceUID: '1.2.series',
  }),
};

describe('annotationToV4Measurement（3D → dcmjs V4 扁平结构）', () => {
  it('Length：handles + length', () => {
    const v4 = annotationToV4Measurement(lengthAnnotation()) as {
      handles: { start: { x: number; y: number }; end: { x: number; y: number } };
      length: number;
    };
    expect(v4.handles.start).toEqual({ x: 0, y: 0 });
    expect(v4.handles.end).toEqual({ x: 10, y: 5 });
    expect(v4.length).toBe(5.125);
  });

  it('RectangleROI / EllipticalROI：对角角点 + 面积', () => {
    const rect = annotationToV4Measurement(roiAnnotation('RectangleROI')) as {
      handles: { start: { x: number; y: number }; end: { x: number; y: number } };
      cachedStats: { area: number };
    };
    expect(rect.handles.start).toEqual({ x: 0, y: 0 });
    expect(rect.handles.end).toEqual({ x: 10, y: 10 });
    expect(rect.cachedStats.area).toBe(100);

    const ellipse = annotationToV4Measurement(roiAnnotation('EllipticalROI'));
    expect(ellipse).not.toBeNull();
  });

  it('无统计值 / 无法识别的类型返回 null（跳过导出）', () => {
    expect(
      annotationToV4Measurement({ ...lengthAnnotation(), data: { handles: { points: [[0, 0, 0], [1, 1, 0]] }, cachedStats: undefined } }),
    ).toBeNull();
    expect(
      annotationToV4Measurement({
        annotationUID: 'x',
        metadata: { toolName: 'Probe' },
        data: { handles: { points: [[0, 0, 0]] } },
      }),
    ).toBeNull();
  });
});

describe('buildMeasurementSr（FR-5.12，dcmjs 回读）', () => {
  it('生成最小合法 SR：Part-10 可被 dcmjs 解析且含 ContentSequence', () => {
    const buffer = buildMeasurementSr(
      [lengthAnnotation(), roiAnnotation('RectangleROI')],
      resolver,
      { patientName: '张三' },
    );
    expect(buffer).toBeInstanceOf(ArrayBuffer);

    const info = readSrInfo(buffer!);
    expect(info).not.toBeNull();
    expect(info!.sopClassUid).toBe(SR_SOP_CLASS_UID);
    expect(info!.sopInstanceUid).not.toBe('');
    expect(info!.hasContentSequence).toBe(true);
  });

  it('回读的 ContentSequence 可再自然化（dcmtk 同类解析路径）', () => {
    const buffer = buildMeasurementSr([lengthAnnotation()], resolver)!;
    const parsed = data.DicomMessage.readFile(buffer) as {
      dict: Record<string, { Value?: unknown }>;
    };
    // 顶层通用模块字段齐全（SOPClass/实例 UID/检查/序列）
    // dcmjs DicomMessage.readFile 的 dict 键为大写 tag，这里统一转大写再取 Value
    const valueOf = (tag: string): unknown => parsed.dict[tag.toUpperCase()]?.Value;
    expect(valueOf('00080016')).toContain(SR_SOP_CLASS_UID);
    expect(valueOf('0020000d')).toBeDefined();
    expect(valueOf('0020000e')).toBeDefined();
    expect(valueOf('00080060')).toContain('SR');
  });

  it('无可导出测量返回 null', () => {
    expect(buildMeasurementSr([], resolver)).toBeNull();
    expect(
      buildMeasurementSr(
        [
          {
            annotationUID: 'u',
            metadata: { toolName: 'Probe', referencedImageId: 'dcm-file://k1' },
            data: { handles: { points: [[0, 0, 0]] } },
          },
        ],
        resolver,
      ),
    ).toBeNull();
  });
});

describe('createSrMetadataProvider', () => {
  it('按类型回填 generalSeriesModule / sopCommonModule / frameNumber', () => {
    const provider = createSrMetadataProvider(resolver);
    expect(provider.get('generalSeriesModule', 'dcm-file://k1')).toEqual({
      studyInstanceUID: '1.2.study',
      seriesInstanceUID: '1.2.series',
    });
    expect(provider.get('sopCommonModule', 'dcm-file://k1')).toEqual({
      sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
      sopInstanceUID: '1.2.88',
      frame: 1,
    });
    expect(provider.get('frameNumber', 'dcm-file://k1')).toBe(1);
  });
});

describe('SR_TOOL_TYPE_MAP（支持工具）', () => {
  it('Length/Angle/RectangleROI/EllipticalROI 可导出', () => {
    expect(SR_TOOL_TYPE_MAP).toMatchObject({
      Length: 'Length',
      Angle: 'Angle',
      RectangleROI: 'RectangleRoi',
      EllipticalROI: 'EllipticalRoi',
    });
  });
});