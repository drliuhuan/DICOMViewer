/**
 * M10-E 参考线随动投影计算单测（FR-6.10）。
 * 纯逻辑：computeReferenceLineSegments / clipLineToRect / planeParallelToView /
 * readMprReferenceCenter。
 */
import { describe, expect, it } from 'vitest';
import {
  clipLineToRect,
  computeReferenceLineSegments,
  planeParallelToView,
  readMprReferenceCenter,
  referenceLineColor,
} from '../src/features/mpr/referenceLines';

describe('clipLineToRect', () => {
  const w = 10;
  const h = 10;

  it('竖直直线裁切成矩形内线段', () => {
    const seg = clipLineToRect(5, 0, 0, -1, w, h)!;
    expect(seg).not.toBeNull();
    expect(Math.abs(seg.p1.x - 5)).toBeLessThan(1e-6);
    expect(Math.abs(seg.p2.x - 5)).toBeLessThan(1e-6);
    const ys = [seg.p1.y, seg.p2.y];
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(10);
  });

  it('水平直线裁切成矩形内线段', () => {
    const seg = clipLineToRect(0, 4, 1, 0, w, h)!;
    expect(seg).not.toBeNull();
    expect(Math.abs(seg.p1.y - 4)).toBeLessThan(1e-6);
    expect(Math.abs(seg.p2.y - 4)).toBeLessThan(1e-6);
    const xs = [seg.p1.x, seg.p2.x];
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(10);
  });

  it('起点在矩形外也能正确裁切', () => {
    const seg = clipLineToRect(-5, 5, 1, 0, w, h)!;
    expect(seg).not.toBeNull();
    const xs = [seg.p1.x, seg.p2.x];
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(10);
  });

  it('整条在矩形外返回 null', () => {
    expect(clipLineToRect(20, 15, 1, 0, w, h)).toBeNull();
    expect(clipLineToRect(5, 3, 0, -1, w, h)).not.toBeNull();
  });
});

describe('planeParallelToView', () => {
  it('与切片同向的平面判定为平行', () => {
    // 轴向：法向 (0,0,1) 与切片法向一致
    expect(planeParallelToView([0, 0, 1], [1, 0, 0], [0, 1, 0])).toBe(true);
    // 冠状/矢状与轴向切片不平行
    expect(planeParallelToView([0, 1, 0], [1, 0, 0], [0, 1, 0])).toBe(false);
    expect(planeParallelToView([1, 0, 0], [1, 0, 0], [0, 1, 0])).toBe(false);
  });
});

describe('computeReferenceLineSegments（轴向 2D 切片）', () => {
  const origin = [0, 0, 0] as [number, number, number];
  const rowDir = [1, 0, 0] as [number, number, number];
  const colDir = [0, 1, 0] as [number, number, number];
  const width = 10;
  const height = 10;

  it('轴向切片显示冠状（水平）与矢状（竖直）两条交线，轴向平面被跳过', () => {
    const center = [5, 4, 0] as [number, number, number];
    const lines = computeReferenceLineSegments(
      { origin, rowDir, colDir, center, width, height },
      1,
      1,
    );
    expect(lines).toHaveLength(2);

    const planes = lines.map((line) => line.plane).sort();
    expect(planes).toEqual(['coronal', 'sagittal']);

    const sagittal = lines.find((line) => line.plane === 'sagittal')!;
    // 矢状平面交线 → 竖直（列坐标恒为 x_C=5）
    expect(sagittal.segment.p1.x).toBeCloseTo(5);
    expect(sagittal.segment.p2.x).toBeCloseTo(5);

    const coronal = lines.find((line) => line.plane === 'coronal')!;
    // 冠状平面交线 → 水平（行坐标恒为 y_C=4）
    expect(coronal.segment.p1.y).toBeCloseTo(4);
    expect(coronal.segment.p2.y).toBeCloseTo(4);
  });

  it('中心在轴外不影响轴向视图交线（取决于面到切片距离投影）', () => {
    const lines = computeReferenceLineSegments(
      { origin, rowDir, colDir, center: [8, 2, 100], width, height },
      1,
      1,
    );
    expect(lines).toHaveLength(2);
    const sagittal = lines.find((line) => line.plane === 'sagittal')!;
    expect(sagittal.segment.p1.x).toBeCloseTo(8);
    const coronal = lines.find((line) => line.plane === 'coronal')!;
    expect(coronal.segment.p1.y).toBeCloseTo(2);
  });

  it('矢状 2D 切片：显示轴向（竖直）与冠状（水平）交线', () => {
    // 矢状切片：行方向沿 z（轴向），列沿 -y；center 落在本切片 y 范围内 [-10,0]
    const sagRowDir = [0, 0, 1] as [number, number, number];
    const sagColDir = [0, -1, 0] as [number, number, number];
    const lines = computeReferenceLineSegments(
      { origin, rowDir: sagRowDir, colDir: sagColDir, center: [3, -5, 6], width, height },
      1,
      1,
    );
    const planes = lines.map((line) => line.plane).sort();
    expect(planes).toEqual(['axial', 'coronal']);
    // 轴向平面交线：z=z_C 恒定 → 竖直（列坐标 c=6），冠状面 y=y_C → 行坐标 r=5
    const axial = lines.find((line) => line.plane === 'axial')!;
    expect(axial.segment.p1.x).toBeCloseTo(6);
    const coronal = lines.find((line) => line.plane === 'coronal')!;
    expect(coronal.segment.p1.y).toBeCloseTo(5);
  });
});

describe('readMprReferenceCenter（退出 MPR 捕获十字交点）', () => {
  it('从轴向视口 camera.focalPoint 读取世界坐标', () => {
    const engine = {
      getViewport: (id: string) =>
        id === 'mpr-axial'
          ? { getCamera: () => ({ focalPoint: [1, 2, 3] }) }
          : undefined,
    };
    expect(readMprReferenceCenter(engine)).toEqual([1, 2, 3]);
  });

  it('无轴向视口 / 无 focalPoint / 非法值时返回 null', () => {
    expect(readMprReferenceCenter(null)).toBeNull();
    expect(readMprReferenceCenter(undefined)).toBeNull();
    expect(readMprReferenceCenter({ getViewport: () => undefined })).toBeNull();
    expect(
      readMprReferenceCenter({
        getViewport: () => ({ getCamera: () => ({}) }),
      }),
    ).toBeNull();
    expect(
      readMprReferenceCenter({
        getViewport: () => ({ getCamera: () => ({ focalPoint: [1, Number.NaN, 3] }) }),
      }),
    ).toBeNull();
    // getCamera 抛异常容错
    expect(readMprReferenceCenter({ getViewport: () => ({ getCamera: () => { throw new Error('x'); } }) })).toBeNull();
  });
});

describe('referenceLineColor', () => {
  it('医学惯例配色：红=矢状 / 绿=冠状 / 黄=轴向', () => {
    expect(referenceLineColor('sagittal')).toBe('#ff0000');
    expect(referenceLineColor('coronal')).toBe('#00ff00');
    expect(referenceLineColor('axial')).toBe('#ffff00');
  });
});