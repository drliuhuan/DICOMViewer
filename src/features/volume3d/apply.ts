/**
 * 3D 体绘制 vtk 装配层（FR-7.2/7.3/7.4/7.7/7.8/7.9，M10-C）。
 *
 * 全部函数以「可注入 vtk 对象 / 可注入视口」的依赖注入方式编写：
 * - 纯几何（computeAxialTopDownCamera / buildClippingPlanes）不依赖 vtk；
 * - 真实 vtk 装配（buildCtf / buildPwf / installClippingPlanes）通过
 *   getVtk() 动态 import，单测传桩对象即可（避免 Node 加载重 vtk）。
 *
 * 本模块顶层不 import vtk.js（Node 单测安全）。
 */
import type { Volume3dPreset } from './presets';

/** vtk 装配所需的最小 vtk API（可注入桩） */
export interface VtkApi {
  vtkColorTransferFunction: { newInstance: (init?: unknown) => CtfLike };
  vtkPiecewiseFunction: { newInstance: (init?: unknown) => PwfLike };
  vtkPlane: { newInstance: (init?: unknown) => PlaneLike };
}

export interface CtfLike {
  addRGBPoint(x: number, r: number, g: number, b: number): unknown;
  setMappingRange(min: number, max: number): unknown;
}

export interface PwfLike {
  addPoint(x: number, opacity: number): unknown;
}

export interface PlaneLike {
  setNormal(normal: [number, number, number]): unknown;
  setOrigin(origin: [number, number, number]): unknown;
}

/** 真实 vtk 动态装配（浏览器运行时） */
export async function getRealVtk(): Promise<VtkApi> {
  const [ctfMod, pwfMod, planeMod] = await Promise.all([
    import('@kitware/vtk.js/Rendering/Core/ColorTransferFunction'),
    import('@kitware/vtk.js/Common/DataModel/PiecewiseFunction'),
    import('@kitware/vtk.js/Common/DataModel/Plane'),
  ]);
  return {
    vtkColorTransferFunction: ctfMod.default as unknown as VtkApi['vtkColorTransferFunction'],
    vtkPiecewiseFunction: pwfMod.default as unknown as VtkApi['vtkPiecewiseFunction'],
    vtkPlane: planeMod.default as unknown as VtkApi['vtkPlane'],
  };
}

export interface VolumePropertyLike {
  setRGBTransferFunction(index: number, ctf: unknown): void;
  setScalarOpacity(index: number, pwf: unknown): void;
  setScalarOpacityUnitDistance(index: number, distance: number): void;
}

export interface VolumeActorLike {
  getProperty(): VolumePropertyLike;
}

/**
 * 从预设数据构建 vtkColorTransferFunction（RGB 节点）。
 */
export function buildColorTransferFunction(
  preset: Volume3dPreset,
  vtk: Pick<VtkApi, 'vtkColorTransferFunction'>,
): CtfLike {
  const ctf = vtk.vtkColorTransferFunction.newInstance();
  for (const node of preset.color) {
    ctf.addRGBPoint(node.x, node.r, node.g, node.b);
  }
  const first = preset.color[0];
  const last = preset.color[preset.color.length - 1];
  if (first && last) {
    ctf.setMappingRange(first.x, last.x);
  }
  return ctf;
}

/** 从预设数据构建 vtkPiecewiseFunction（不透明度节点）。 */
export function buildPiecewiseFunction(
  preset: Volume3dPreset,
  vtk: Pick<VtkApi, 'vtkPiecewiseFunction'>,
): PwfLike {
  const pwf = vtk.vtkPiecewiseFunction.newInstance();
  for (const node of preset.opacity) {
    pwf.addPoint(node.x, node.opacity);
  }
  return pwf;
}

export interface ApplyPresetOptions {
  /** 真实 vtk 装配依赖（默认动态 import） */
  getVtk?: () => Promise<VtkApi>;
  /** 各向平均体素间距（mm），用于标定不透明度光学深度；缺省跳过 */
  spacing?: [number, number, number] | null;
}

/**
 * 把预设的颜色/不透明度传递函数赋给 volume actor 的 vtkVolumeProperty
 * （FR-7.2）：setRGBTransferFunction(0, ctf) + setScalarOpacity(0, pwf)。
 */
export async function applyPresetToVolumeActor(
  volumeActor: VolumeActorLike,
  preset: Volume3dPreset,
  options: ApplyPresetOptions = {},
): Promise<void> {
  const vtk = await (options.getVtk ?? getRealVtk)();
  const property = volumeActor.getProperty();
  property.setRGBTransferFunction(0, buildColorTransferFunction(preset, vtk));
  property.setScalarOpacity(0, buildPiecewiseFunction(preset, vtk));
  if (options.spacing) {
    const meanVoxel = (options.spacing[0] + options.spacing[1] + options.spacing[2]) / 3;
    if (Number.isFinite(meanVoxel) && meanVoxel > 0) {
      property.setScalarOpacityUnitDistance(0, meanVoxel);
    }
  }
}

export interface WwWlViewportLike {
  setProperties(properties: { voiRange: { lower: number; upper: number } }, volumeId?: string, suppressEvents?: boolean): void;
  getProperties?(volumeId?: string): { voiRange?: { lower: number; upper: number } } | null | undefined;
  render?(): void;
}

/** 应用窗宽窗位到 3D 视口：转成映射范围 setProperties({voiRange})，实时影响体绘制（FR-7.3）。 */
export function applyWwWlToViewport(viewport: WwWlViewportLike, ww: number, wl: number): void {
  if (!Number.isFinite(ww) || ww <= 0 || !Number.isFinite(wl)) {
    return;
  }
  const lower = wl - ww / 2;
  const upper = wl + ww / 2;
  viewport.setProperties({ voiRange: { lower, upper } });
  viewport.render?.();
}

export interface Volume3dViewportLike {
  getDefaultActor(): { actor?: VolumeActorLike } | undefined;
  getImageData(): { spacing?: [number, number, number] } | undefined;
  resetCamera?(): boolean;
  render?(): void;
}

/**
 * 对 3D 视口应用渲染预设：取默认 volume actor → 应用传递函数。
 * 返回 true 表示已应用；actor 缺失时返回 false。
 */
export async function applyPresetToViewport(
  viewport: Volume3dViewportLike,
  preset: Volume3dPreset,
  options: ApplyPresetOptions = {},
): Promise<boolean> {
  const entry = viewport.getDefaultActor();
  const actor = entry?.actor;
  if (!actor) {
    return false;
  }
  const spacing = viewport.getImageData?.()?.spacing ?? null;
  await applyPresetToVolumeActor(actor, preset, { ...options, spacing });
  viewport.render?.();
  return true;
}

export interface SampleDistanceViewportLike {
  setSampleDistanceMultiplier(multiplier: number): void;
  render?(): void;
}

/** 应用渲染质量（采样距离倍数，FR-7.7）。 */
export function applySampleDistanceMultiplier(
  viewport: SampleDistanceViewportLike,
  multiplier: number,
): void {
  viewport.setSampleDistanceMultiplier(multiplier);
  viewport.render?.();
}

/**
 * 3D 视口截图（FR-7.8）：从视口 canvas 导出 PNG 并触发下载。
 * 返回 dataURL；canvas 不可用时返回 null。
 */
export interface CanvasLike {
  toDataURL(type?: string): string;
}

export interface DocLike {
  createElement(tagName: string): {
    href?: string;
    download?: string;
    style?: { display?: string };
    click(): void;
  };
  body?: { appendChild(node: unknown): void; removeChild?(node: unknown): void };
}

/** 触发 dataURL 的下载（a[download] 点击），默认 document。 */
export function downloadDataUrl(
  dataUrl: string,
  filename: string,
  doc: DocLike = (typeof document !== 'undefined' ? document : undefined) as DocLike,
): void {
  if (!doc || typeof doc.createElement !== 'function') {
    return;
  }
  const anchor = doc.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  if (anchor.style) {
    anchor.style.display = 'none';
  }
  doc.body?.appendChild(anchor);
  anchor.click();
  doc.body?.removeChild?.(anchor);
}

export function screenshotVolume3d(
  viewport: { getCanvas(): CanvasLike | null },
  filename: string,
  doc?: DocLike,
): string | null {
  const canvas = viewport.getCanvas();
  if (!canvas || typeof canvas.toDataURL !== 'function') {
    return null;
  }
  const dataUrl = canvas.toDataURL('image/png');
  downloadDataUrl(dataUrl, filename, doc);
  return dataUrl;
}

/** 归一化三维向量；长度过小时回退给定的默认轴 */
function normalizeVec(x: number, y: number, z: number, fallback: [number, number, number]): [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) {
    return fallback;
  }
  return [x / length, y / length, z / length];
}

/** 把 -0 归一为 0（向量分量断言/下游计算更稳定） */
function cleanZero(value: number): number {
  return value === 0 ? 0 : value;
}

export interface CameraImageInfo {
  /** 世界坐标包围盒 [x0,x1,y0,y1,z0,z1] */
  bounds: [number, number, number, number, number, number];
  /** vtkImageData.getDirection() 4×4（列 0/1/2 = x/y/z 轴） */
  direction: ArrayLike<number>;
}

export interface AxialTopDownCamera {
  position: [number, number, number];
  focalPoint: [number, number, number];
  viewPlaneNormal: [number, number, number];
  viewUp: [number, number, number];
  viewAngle: number;
  parallelProjection: boolean;
}

/**
 * 计算「轴位俯视」默认视角相机（FR-7.9）：
 * - 相机置于体数据切片轴上方、面向体心（沿切片轴俯视）；
 * - 视角上方向取切片行轴的反向（轴向影像「前」在上，与 MPR 轴向约定一致）；
 * - 距离按包围盒外接球半径适配（默认 30° 视角）。
 */
export function computeAxialTopDownCamera(
  info: CameraImageInfo,
): AxialTopDownCamera | null {
  const [x0, x1, y0, y1, z0, z1] = info.bounds;
  if (
    ![x0, x1, y0, y1, z0, z1].every((value) => Number.isFinite(value) && value === value)
  ) {
    return null;
  }
  const center: [number, number, number] = [
    (x0 + x1) / 2,
    (y0 + y1) / 2,
    (z0 + z1) / 2,
  ];
  const dir = info.direction;
  // vtkImageData direction 4×4：第 2 列 = 切片轴，第 1 列 = 行轴
  const slice = normalizeVec(dir[8] ?? 0, dir[9] ?? 0, dir[10] ?? 0, [0, 0, 1]);
  const row = normalizeVec(dir[4] ?? 0, dir[5] ?? 0, dir[6] ?? 0, [0, 1, 0]);
  const viewUp: [number, number, number] = [cleanZero(-row[0]), cleanZero(-row[1]), cleanZero(-row[2])];
  const viewPlaneNormal: [number, number, number] = [cleanZero(-slice[0]), cleanZero(-slice[1]), cleanZero(-slice[2])];
  const radius = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const viewAngleRad = (30 * Math.PI) / 180;
  const fitDistance = radius / Math.sin(viewAngleRad / 2);
  const distance = fitDistance * 1.5;
  return {
    position: [center[0] + slice[0] * distance, center[1] + slice[1] * distance, center[2] + slice[2] * distance],
    focalPoint: center,
    viewPlaneNormal,
    viewUp,
    viewAngle: 30,
    parallelProjection: false,
  };
}

export interface ResetCameraViewportLike {
  getImageData(): { imageData?: { getBounds(): [number, number, number, number, number, number] }; direction?: ArrayLike<number> } | undefined;
  getCamera(): { parallelScale?: number; parallelProjection?: boolean };
  setCamera(camera: Record<string, unknown>, storeAsInitialCamera?: boolean): void;
  resetCamera?(): boolean;
  render?(): void;
}

/**
 * 复位视角＝一键恢复「轴位俯视」（FR-7.9）：
 * 按体数据方向/包围盒计算轴位俯视相机并设置为初始相机，再 resetCamera 取景。
 */
export function resetVolume3dCamera(viewport: ResetCameraViewportLike): void {
  const imageData = viewport.getImageData();
  const bounds = imageData?.imageData?.getBounds?.();
  const direction = imageData?.direction;
  if (!bounds || !direction) {
    viewport.resetCamera?.();
    viewport.render?.();
    return;
  }
  const camera = computeAxialTopDownCamera({ bounds, direction });
  if (!camera) {
    viewport.resetCamera?.();
    viewport.render?.();
    return;
  }
  const current = viewport.getCamera();
  viewport.setCamera(
    {
      ...camera,
      // 保留当前投影模式设置（perspective 默认），平行投影模式保留比例
      parallelProjection: current.parallelProjection ?? camera.parallelProjection,
      parallelScale: current.parallelScale,
    },
    true,
  );
  viewport.resetCamera?.();
  viewport.render?.();
}

/** 世界轴缩写（轴向裁剪方向），与 buildClippingPlanes 的键一致 */
export type ClipAxisKey = 'axial' | 'coronal' | 'sagittal';

/** 裁剪平面状态：value = 裁剪比例 fraction（0..1）；null = 该方向不裁剪 */
export type ClipState = Partial<Record<ClipAxisKey, number>>;

export interface ClipInfo {
  /** 世界坐标包围盒 [x0,x1,y0,y1,z0,z1] */
  bounds: [number, number, number, number, number, number];
  /** vtkImageData.getDirection() 4×4 */
  direction: ArrayLike<number>;
}

export interface ClipPlaneDescription {
  axis: ClipAxisKey;
  /** 裁剪平面法向（世界） */
  normal: [number, number, number];
  /** 裁剪平面原点（世界） */
  origin: [number, number, number];
}

/**
 * 由裁剪状态计算各向裁剪平面描述（纯几何，FR-7.4）：
 * - 轴向裁剪沿切片轴、冠状沿行轴、矢状沿列轴；
 * - fraction f → 平面原点 = 边界外向起点 + 轴向偏移 f，法向 = 轴向反向
 *   （切掉沿该轴超出 f 的部分，露出内部结构）。
 */
export function buildClippingPlanes(
  info: ClipInfo,
  clipState: ClipState,
): ClipPlaneDescription[] {
  const dir = info.direction;
  const axes: Record<ClipAxisKey, [number, number, number]> = {
    // 列 0 = 列轴（矢状方向，左右），列 1 = 行轴（冠状方向，前后），列 2 = 切片轴（轴向，头足）
    sagittal: normalizeVec(dir[0] ?? 0, dir[1] ?? 0, dir[2] ?? 0, [1, 0, 0]),
    coronal: normalizeVec(dir[4] ?? 0, dir[5] ?? 0, dir[6] ?? 0, [0, 1, 0]),
    axial: normalizeVec(dir[8] ?? 0, dir[9] ?? 0, dir[10] ?? 0, [0, 0, 1]),
  };
  const [b0, b1, b2, b3, b4, b5] = info.bounds;
  const lower: [number, number, number] = [b0, b2, b4];
  const upper: [number, number, number] = [b1, b3, b5];

  const planes: ClipPlaneDescription[] = [];
  for (const axis of ['axial', 'coronal', 'sagittal'] as const) {
    const fraction = clipState[axis];
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
      continue;
    }
    const clamped = Math.min(1, Math.max(0, fraction));
    if (clamped <= 0) {
      continue;
    }
    const dirAxis = axes[axis];
    // 沿轴向距离（单位向量投影）
    const extent =
      (dirAxis[0] * (upper[0] - lower[0]) || 0) +
      (dirAxis[1] * (upper[1] - lower[1]) || 0) +
      (dirAxis[2] * (upper[2] - lower[2]) || 0);
    if (extent <= 0) {
      continue;
    }
    planes.push({
      axis,
      normal: [cleanZero(-dirAxis[0]), cleanZero(-dirAxis[1]), cleanZero(-dirAxis[2])],
      origin: [
        lower[0] + dirAxis[0] * extent * clamped,
        lower[1] + dirAxis[1] * extent * clamped,
        lower[2] + dirAxis[2] * extent * clamped,
      ],
    });
  }
  return planes;
}

export interface ClipMapperLike {
  removeAllClippingPlanes?(): void;
  addClippingPlane?(plane: unknown): void;
  modified?(): void;
}

/**
 * 把裁剪平面描述落到 volume mapper 的硬件裁剪平面（FR-7.4）。
 * 先清空既有平面再逐个加入，避免残留交错裁剪。
 */
export function installClippingPlanes(
  mapper: ClipMapperLike,
  planes: readonly ClipPlaneDescription[],
  vtk: Pick<VtkApi, 'vtkPlane'>,
): void {
  if (mapper.removeAllClippingPlanes) {
    mapper.removeAllClippingPlanes();
  }
  for (const description of planes) {
    const plane = vtk.vtkPlane.newInstance();
    plane.setNormal(description.normal);
    plane.setOrigin(description.origin);
    mapper.addClippingPlane?.(plane);
  }
  mapper.modified?.();
}

export interface ClipViewportLike {
  getDefaultActor(): { actor?: VolumeActorLike } | undefined;
  render?(): void;
}

export interface ClippingVolumeActorLike extends VolumeActorLike {
  getMapper(): ClipMapperLike | undefined;
}

/**
 * 应用裁剪状态到 3D 视口的默认 volume actor mapper（FR-7.4）。
 * 返回是否成功应用。
 */
export async function applyClippingToViewport(
  viewport: ClipViewportLike,
  clipState: ClipState,
  imageInfo: ClipInfo | null,
  options: { getVtk?: () => Promise<VtkApi> } = {},
): Promise<boolean> {
  const entry = viewport.getDefaultActor();
  const actor = entry?.actor as ClippingVolumeActorLike | undefined;
  const mapper = actor?.getMapper?.();
  if (!actor || !mapper) {
    return false;
  }
  const vtk = await (options.getVtk ?? getRealVtk)();
  const planes = imageInfo ? buildClippingPlanes(imageInfo, clipState) : [];
  installClippingPlanes(mapper, planes, vtk);
  viewport.render?.();
  return true;
}