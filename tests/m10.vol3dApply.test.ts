/**
 * M10-C 3D vtk 装配层（apply.ts）：预设→传递函数、相机复位几何、
 * 裁剪平面几何、窗宽窗位、截图下载。全部以注入桩测试，不加载真实 vtk。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyClippingToViewport,
  applyPresetToVolumeActor,
  applyWwWlToViewport,
  buildClippingPlanes,
  buildColorTransferFunction,
  buildPiecewiseFunction,
  computeAxialTopDownCamera,
  downloadDataUrl,
  installClippingPlanes,
  screenshotVolume3d,
  type ClipState,
  type VtkApi,
} from '../src/features/volume3d/apply';
import type { Volume3dPreset } from '../src/features/volume3d/presets';
import { findVolume3dPreset } from '../src/features/volume3d/presets';

const bonePreset = findVolume3dPreset('ct-bone') as Volume3dPreset;

function makeCtfMock() {
  return { addRGBPoint: vi.fn(), setMappingRange: vi.fn() };
}
function makePwfMock() {
  return { addPoint: vi.fn() };
}
function makePlaneMock() {
  return { setNormal: vi.fn(), setOrigin: vi.fn() };
}
function makeVtk(): VtkApi {
  return {
    vtkColorTransferFunction: { newInstance: vi.fn(() => makeCtfMock()) },
    vtkPiecewiseFunction: { newInstance: vi.fn(() => makePwfMock()) },
    vtkPlane: { newInstance: vi.fn(() => makePlaneMock()) },
  };
}

describe('buildColorTransferFunction / buildPiecewiseFunction（FR-7.2）', () => {
  it('颜色节点逐一 addRGBPoint 并按首末节点设置映射范围', () => {
    const vtk = makeVtk();
    const ctf = buildColorTransferFunction(bonePreset, vtk);
    expect(vtk.vtkColorTransferFunction.newInstance).toHaveBeenCalledTimes(1);
    expect(ctf.addRGBPoint).toHaveBeenCalledTimes(bonePreset.color.length);
    expect(ctf.addRGBPoint).toHaveBeenCalledWith(
      bonePreset.color[0]!.x,
      bonePreset.color[0]!.r,
      bonePreset.color[0]!.g,
      bonePreset.color[0]!.b,
    );
    expect(ctf.setMappingRange).toHaveBeenCalledWith(
      bonePreset.color[0]!.x,
      bonePreset.color[bonePreset.color.length - 1]!.x,
    );
  });

  it('不透明度节点逐一 addPoint', () => {
    const vtk = makeVtk();
    const pwf = buildPiecewiseFunction(bonePreset, vtk);
    expect(pwf.addPoint).toHaveBeenCalledTimes(bonePreset.opacity.length);
    expect(pwf.addPoint).toHaveBeenCalledWith(bonePreset.opacity[0]!.x, bonePreset.opacity[0]!.opacity);
  });
});

describe('applyPresetToVolumeActor（FR-7.2）', () => {
  it('把色/不透明度传递函数赋给 volume property，并设置体素光学距离', async () => {
    const setRGBTransferFunction = vi.fn();
    const setScalarOpacity = vi.fn();
    const setScalarOpacityUnitDistance = vi.fn();
    const actor = { getProperty: () => ({ setRGBTransferFunction, setScalarOpacity, setScalarOpacityUnitDistance }) };
    const vtk = makeVtk();
    await applyPresetToVolumeActor(actor, bonePreset, {
      getVtk: async () => vtk,
      spacing: [0.5, 0.5, 1.0],
    });
    expect(setRGBTransferFunction).toHaveBeenCalledTimes(1);
    expect(setRGBTransferFunction.mock.calls[0]?.[0]).toBe(0);
    expect(setScalarOpacity).toHaveBeenCalledTimes(1);
    expect(setScalarOpacity.mock.calls[0]?.[0]).toBe(0);
    expect(setScalarOpacityUnitDistance).toHaveBeenCalledWith(0, (0.5 + 0.5 + 1.0) / 3);
  });

  it('无 spacing 时不设置光学距离（不抛错）', async () => {
    const setRGBTransferFunction = vi.fn();
    const setScalarOpacity = vi.fn();
    const setScalarOpacityUnitDistance = vi.fn();
    const actor = { getProperty: () => ({ setRGBTransferFunction, setScalarOpacity, setScalarOpacityUnitDistance }) };
    await applyPresetToVolumeActor(actor, bonePreset, { getVtk: async () => makeVtk() });
    expect(setScalarOpacityUnitDistance).not.toHaveBeenCalled();
  });
});

describe('computeAxialTopDownCamera（FR-7.9）', () => {
  const bounds: [number, number, number, number, number, number] = [0, 256, 0, 256, 0, 128];
  // vtk direction 4×4，标准轴向：x=[1,0,0,0]，y=[0,1,0,0]，z=[0,0,1,0]
  const axialDirection = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  it('标准轴向体：相机在 +Z 上方俯视体心，viewUp 取行轴反向（前在上）', () => {
    const camera = computeAxialTopDownCamera({ bounds, direction: axialDirection });
    expect(camera).not.toBeNull();
    expect(camera!.focalPoint).toEqual([128, 128, 64]);
    expect(camera!.viewPlaneNormal).toEqual([0, 0, -1]);
    expect(camera!.viewUp).toEqual([0, -1, 0]);
    expect(camera!.position[0]).toBe(128);
    expect(camera!.position[1]).toBe(128);
    expect(camera!.position[2]).toBeGreaterThan(64);
  });

  it('包围盒含非有限值 → 返回 null（回退 resetCamera）', () => {
    const bad = [NaN, 256, 0, 256, 0, 128] as [number, number, number, number, number, number];
    expect(computeAxialTopDownCamera({ bounds: bad, direction: axialDirection })).toBeNull();
  });
});

describe('buildClippingPlanes（FR-7.4 纯几何）', () => {
  const bounds: [number, number, number, number, number, number] = [0, 100, 0, 100, 0, 100];
  const axialDirection = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  it('轴向裁剪 50%：法向沿 -z，原点在 z=50', () => {
    const planes = buildClippingPlanes(
      { bounds, direction: axialDirection },
      { axial: 0.5 } as ClipState,
    );
    expect(planes).toHaveLength(1);
    expect(planes[0]!.axis).toBe('axial');
    expect(planes[0]!.normal).toEqual([0, 0, -1]);
    expect(planes[0]!.origin).toEqual([0, 0, 50]);
  });

  it('矢状/冠状裁剪沿对应轴', () => {
    const planes = buildClippingPlanes(
      { bounds, direction: axialDirection },
      { sagittal: 0.25, coronal: 0.75 } as ClipState,
    );
    const sagittal = planes.find((p) => p.axis === 'sagittal');
    const coronal = planes.find((p) => p.axis === 'coronal');
    expect(sagittal?.normal).toEqual([-1, 0, 0]);
    expect(sagittal?.origin).toEqual([25, 0, 0]);
    expect(coronal?.normal).toEqual([0, -1, 0]);
    expect(coronal?.origin).toEqual([0, 75, 0]);
  });

  it('fraction 0 / 缺失 → 不生成裁剪平面', () => {
    expect(buildClippingPlanes({ bounds, direction: axialDirection }, { axial: 0 })).toHaveLength(0);
    expect(buildClippingPlanes({ bounds, direction: axialDirection }, {})).toHaveLength(0);
  });

  it('fraction > 1 夹紧到 1（法向反向去掉全部量）', () => {
    const planes = buildClippingPlanes(
      { bounds, direction: axialDirection },
      { axial: 2 } as ClipState,
    );
    expect(planes[0]!.origin).toEqual([0, 0, 100]);
  });
});

describe('installClippingPlanes（FR-7.4）', () => {
  it('先清空既有平面，逐个 vtkPlane 添加并触发 modified', () => {
    const removeAllClippingPlanes = vi.fn();
    const addClippingPlane = vi.fn();
    const modified = vi.fn();
    const mapper = { removeAllClippingPlanes, addClippingPlane, modified };
    const vtk = makeVtk();
    installClippingPlanes(
      mapper,
      [{ axis: 'axial', normal: [0, 0, -1], origin: [0, 0, 50] }],
      vtk,
    );
    expect(removeAllClippingPlanes).toHaveBeenCalledTimes(1);
    expect(vtk.vtkPlane.newInstance).toHaveBeenCalledTimes(1);
    expect(addClippingPlane).toHaveBeenCalledTimes(1);
    expect(modified).toHaveBeenCalledTimes(1);
  });
});

describe('applyWwWlToViewport（FR-7.3）', () => {
  it('ww/wl → voiRange{lower,upper} 并经 setProperties 应用到体绘制映射', () => {
    const setProperties = vi.fn();
    const render = vi.fn();
    applyWwWlToViewport({ setProperties, render }, 800, 300);
    expect(setProperties).toHaveBeenCalledWith({ voiRange: { lower: -100, upper: 700 } });
    expect(render).toHaveBeenCalled();
  });

  it('非法值直接忽略（不抛错、不 setProperties）', () => {
    const setProperties = vi.fn();
    applyWwWlToViewport({ setProperties, render: vi.fn() }, 0, 100);
    applyWwWlToViewport({ setProperties, render: vi.fn() }, NaN, 100);
    expect(setProperties).not.toHaveBeenCalled();
  });
});

describe('downloadDataUrl / screenshotVolume3d（FR-7.8）', () => {
  it('screenshotVolume3d：canvas → dataURL png → 触发下载并返回', () => {
    const click = vi.fn();
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const doc = {
      createElement: vi.fn(() => ({ href: '', download: '', click })),
      body: { appendChild, removeChild },
    };
    const viewport = {
      getCanvas: () => ({ toDataURL: vi.fn(() => 'data:image/png;base64,AAA') }),
    };
    const dataUrl = screenshotVolume3d(viewport as never, 'shot.png', doc as never);
    expect(dataUrl).toBe('data:image/png;base64,AAA');
    expect(doc.createElement).toHaveBeenCalledWith('a');
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);
  });

  it('canvas 不可用 → 返回 null，不触发下载', () => {
    const doc = {
      createElement: vi.fn(() => ({ click: vi.fn() })),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    expect(screenshotVolume3d({ getCanvas: () => null }, 'x.png', doc as never)).toBeNull();
    expect(doc.createElement).not.toHaveBeenCalled();
  });

  it('downloadDataUrl 直接下载（默认 document 兜底）', () => {
    downloadDataUrl('data:image/png;base64,B', 'a.png'); // 不抛错即可
    expect(true).toBe(true);
  });
});

describe('applyClippingToViewport（FR-7.4）', () => {
  it('取默认 actor 的 mapper，清空旧裁剪并安装新平面', async () => {
    const removeAllClippingPlanes = vi.fn();
    const addClippingPlane = vi.fn();
    const modified = vi.fn();
    const render = vi.fn();
    const mapper = { removeAllClippingPlanes, addClippingPlane, modified };
    const viewport = {
      getDefaultActor: () => ({ actor: { getProperty: vi.fn(), getMapper: () => mapper } }),
      render,
    };
    const bounds: [number, number, number, number, number, number] = [0, 10, 0, 10, 0, 10];
    const direction = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const ok = await applyClippingToViewport(viewport as never, { axial: 0.5 } as ClipState, {
      bounds,
      direction,
    }, { getVtk: async () => makeVtk() });
    expect(ok).toBe(true);
    expect(removeAllClippingPlanes).toHaveBeenCalledTimes(1);
    expect(addClippingPlane).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalled();
  });
});