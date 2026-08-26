/**
 * MPR 参考线随动计算（FR-6.10，M10-E）。
 *
 * 需求：切回 2D 单视口后，在该 Stack 视口的当前切片上绘制 MPR 三个正交平面
 * （矢状/冠状/轴向）与切片平面的交线，即 2D 视口内显示 MPR 平面位置参考线。
 *
 * 纯数学：给定切片平面（原点 IPP + 行列方向余弦）与 MPR 十字交点世界坐标，
 * 逐平面求解「MPR 平面 ∩ 切片平面」的直线方程，并把线段裁切到图像像素边界
 * [0,width]×[0,height]；与视图同向的平面（重合为整幅图）跳过，不画线。
 * 全部纯函数，Node 可测；世界坐标 → 画布坐标的投影由调用方（DicomViewport）
 * 用 viewport.worldToCanvas 完成，因此平移/缩放/旋转相机后线条保持正确。
 *
 * 坐标系约定：切片平面上的像素点 world = origin + c·spacingX·rowDir
 * + r·spacingY·colDir，其中 c=列索引（图像 x 轴，沿 IOP 行方向余弦）、
 * r=行索引（图像 y 轴，沿 IOP 列方向余弦）；该映射与 StackViewport 的
 * vtk imageData direction 布局（direction[0..2]=rowCosines 对应轴0、
 * direction[3..5]=columnCosines 对应轴1）对齐。
 */
export type Point2 = { x: number; y: number };
export type Point3 = [number, number, number];
export type MprPlaneKey = 'axial' | 'coronal' | 'sagittal';

export interface LineSegment {
  p1: Point2;
  p2: Point2;
}

export interface ReferenceLineInput {
  /** 切片原点（IPP，世界坐标 mm） */
  origin: Point3;
  /** 行方向余弦（图像 x 轴，IOP[0..2]） */
  rowDir: Point3;
  /** 列方向余弦（图像 y 轴，IOP[3..5]） */
  colDir: Point3;
  /** MPR 十字交点（世界坐标 mm） */
  center: Point3;
  /** 图像像素列数（x 轴范围 [0, width]） */
  width: number;
  /** 图像像素行数（y 轴范围 [0, height]） */
  height: number;
}

export interface ReferenceLineResult {
  plane: MprPlaneKey;
  /** 切片像素坐标内的线段两端点 */
  segment: LineSegment;
}

/** 与切片视平面法向夹角内积阈值：低于视为平行（平面与切片共面，不画线） */
const PARALLEL_DOT_THRESHOLD = 0.98;

/** MPR 三个正交平面的世界法向（LPS，DICOM 体坐标系） */
export const MPR_PLANE_NORMALS: ReadonlyArray<{
  plane: MprPlaneKey;
  normal: Point3;
}> = [
  { plane: 'sagittal', normal: [1, 0, 0] },
  { plane: 'coronal', normal: [0, 1, 0] },
  { plane: 'axial', normal: [0, 0, 1] },
];

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(v: Point3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** 平面与切片是否（近似）平行：|n̂·v̂| 超过阈值即跳过 */
export function planeParallelToView(
  normal: Point3,
  rowDir: Point3,
  colDir: Point3,
): boolean {
  const viewNormal = cross(rowDir, colDir);
  const n = norm(viewNormal);
  if (n < 1e-9) {
    return true;
  }
  const nd = norm(normal);
  if (nd < 1e-9) {
    return true;
  }
  const ratio = Math.abs(dot(normal, viewNormal)) / (nd * n);
  return ratio > PARALLEL_DOT_THRESHOLD;
}

/**
 * 用 Liang-Barsky 把从 (cx,cy) 沿 (dx,dy) 的无限直线裁切成矩形内的线段。
 * @returns 矩形内的线段两端点；整条在矩形外返回 null。
 */
export function clipLineToRect(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  width: number,
  height: number,
): LineSegment | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const clipAxis = (p: number, dp: number, lo: number, hi: number): boolean => {
    if (Math.abs(dp) < 1e-9) {
      return p >= lo && p <= hi;
    }
    let t1 = (lo - p) / dp;
    let t2 = (hi - p) / dp;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    return tMin <= tMax;
  };
  if (!clipAxis(cx, dx, 0, width)) {
    return null;
  }
  if (!clipAxis(cy, dy, 0, height)) {
    return null;
  }
  if (tMax < tMin) {
    return null;
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    // 奇异点：无法构成线段
    return null;
  }
  if (tMin === -Infinity && tMax === Infinity) {
    // 平行于某一轴且落在矩形内：无交点构建不了线段（返回中心点退化线）
    return null;
  }
  const safeTMin = tMin === -Infinity ? -1000 : tMin;
  const safeTMax = tMax === Infinity ? 1000 : tMax;
  return {
    p1: { x: cx + safeTMin * dx, y: cy + safeTMin * dy },
    p2: { x: cx + safeTMax * dx, y: cy + safeTMax * dy },
  };
}

/**
 * 计算 MPR 三个平面在当前 2D 切片上的参考线（FR-6.10）。
 *
 * 对每个与切片不共面的 MPR 平面，求「平面 ∩ 切片平面」的直线方程（精确解）：
 *   切片点 P(c,r) = origin + sc·c·rowDir + sr·r·colDir（sc/sr 为轴间距），
 *   MPR 平面条件 n̂·(P−C)=0 ⇒ A·c + B·r = D，
 *   其中 A=sc·(n̂·rowDir)、B=sr·(n̂·colDir)、D=n̂·(C−origin)。
 *   直线方向 (dc,dr)=(B,−A)（与 (A,B) 正交）；锚点取 c0=D/A（或 r0=D/B）
 *   精确落在直线上，再按像素边界裁切，无斜切近似误差。
 *
 * @param spacingX / spacingY 轴间距（列方向/行方向，mm/px）
 * @returns 各平面的像素坐标线段（按 MPR_PLANE_NORMALS 顺序，跳过共面平面）
 */
export function computeReferenceLineSegments(
  input: ReferenceLineInput,
  spacingX = 1,
  spacingY = 1,
): ReferenceLineResult[] {
  const { origin, rowDir, colDir, center, width, height } = input;
  const results: ReferenceLineResult[] = [];
  const offset = sub(center, origin);
  for (const { plane, normal } of MPR_PLANE_NORMALS) {
    if (planeParallelToView(normal, rowDir, colDir)) {
      continue;
    }
    const A = spacingX * dot(normal, rowDir);
    const B = spacingY * dot(normal, colDir);
    const D = dot(normal, offset);
    if (Math.abs(A) < 1e-9 && Math.abs(B) < 1e-9) {
      continue;
    }
    // 精确锚点：优先取与较大系数对应的轴交点
    let c0: number;
    let r0: number;
    if (Math.abs(A) >= Math.abs(B)) {
      c0 = D / A;
      r0 = 0;
    } else {
      c0 = 0;
      r0 = D / B;
    }
    const segment = clipLineToRect(c0, r0, B, -A, width, height);
    if (segment !== null) {
      results.push({ plane, segment });
    }
  }
  return results;
}

/**
 * 读取 MPR 三平面十字交点（世界坐标）——退出 MPR 时捕获，供 2D 视口画参考线。
 * engine 采用鸭子类型，避免本模块顶层依赖 @cornerstonejs/core（Node 单测安全）。
 * 轴向视口的 camera.focalPoint 即 CrosshairsTool 三平面同步的交心。
 */
export function readMprReferenceCenter(
  engine:
    | { getViewport(id: string): { getCamera(): unknown } | undefined }
    | null
    | undefined,
): Point3 | null {
  try {
    const viewport = engine?.getViewport('mpr-axial');
    if (!viewport) {
      return null;
    }
    const camera = viewport.getCamera() as { focalPoint?: Point3 };
    const focal = camera?.focalPoint;
    if (!Array.isArray(focal) || focal.length < 3 || !focal.every((v) => Number.isFinite(v))) {
      return null;
    }
    return [focal[0], focal[1], focal[2]];
  } catch {
    return null;
  }
}

/** 参考线颜色（与 MPR 三平面定位线同色系：红=矢状/绿=冠状/黄=轴向） */
export function referenceLineColor(plane: MprPlaneKey): string {
  switch (plane) {
    case 'axial':
      return '#ffff00';
    case 'coronal':
      return '#00ff00';
    case 'sagittal':
      return '#ff0000';
  }
}