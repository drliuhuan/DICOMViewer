/**
 * 跨视口切面定位线（FR-3.15，M12-F1）。
 *
 * 场景：同一布局中共存 ≥2 个 2D Stack 视口（如矢状位 + 轴位）时，在
 * 每个非激活视口中画出「激活视口当前切片平面」与该视口平面的交线。
 *
 * 纯几何：输入两侧平面参数（IPP、行/列方向余弦、spacing、rows/cols）与
 * FrameOfReferenceUID，求两平面交线，并把交线裁切到目标平面的像素范围
 * [0, columns] × [0, rows]，输出单条线段。全部为纯函数，无 DOM、无
 * Cornerstone 依赖，Node 可测。
 *
 * 坐标系约定与 `mpr/referenceLines.ts` 一致：
 *   world = origin + c·spacing[0]·rowDir + r·spacing[1]·colDir
 * 其中 c = 列索引（图像 x 轴，沿行方向余弦）、r = 行索引（图像 y 轴，
 * 沿列方向余弦）。该映射与 StackViewport 的 vtk imageData direction
 * 布局（direction[0..2]=rowCosines、direction[3..5]=columnCosines）对齐。
 */
import { clipLineToRect } from '../mpr/referenceLines';
import type { LineSegment, Point3 } from '../mpr/referenceLines';

/** 单个 2D 切片平面的几何参数（世界坐标 / 像素坐标） */
export interface SlicePlaneGeometry {
  /** 检查/序列的 FrameOfReferenceUID；缺失或不同则无法建立空间对应关系 */
  frameOfReferenceUID?: string;
  /** 当前切片的 ImagePositionPatient（世界坐标 mm） */
  origin: Point3;
  /** 行方向余弦（图像 x 轴，IOP[0..2]） */
  rowDir: Point3;
  /** 列方向余弦（图像 y 轴，IOP[3..5]） */
  colDir: Point3;
  /** 像素间距：spacing[0] 沿 rowDir（列方向），spacing[1] 沿 colDir（行方向） */
  spacing: [number, number];
  /** 图像列数（像素 x 范围 [0, columns]） */
  columns: number;
  /** 图像行数（像素 y 范围 [0, rows]） */
  rows: number;
}

/** 由 App 下发给 DicomViewport 的单条跨视口定位线（像素坐标 + 目标平面） */
export interface CrossReferenceLine {
  /** 目标视口像素坐标内的线段 */
  segment: LineSegment;
  /** 线段所属的目标切片平面（用于像素坐标 → 世界坐标投影） */
  geometry: SlicePlaneGeometry;
}

/**
 * 跨视口定位线统一颜色：黄色（医学影像高可见度），不按平面取色。
 * 与 MPR 定位线（红=矢状/绿=冠状/黄=轴向）相互独立。
 */
export const CROSS_REFERENCE_LINE_COLOR = '#ffff00';

/** 数值有效性阈值（零向量 / 零间距判定） */
const EPSILON = 1e-9;
/** 两平面法向叉积归一化阈值：低于视为平行或重合（不画线） */
const PARALLEL_SIN_EPSILON = 1e-6;

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Point3, b: Point3): Point3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function sub(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function norm(v: Point3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function isFinitePoint(p: Point3): boolean {
  return p.every((value) => Number.isFinite(value));
}

function hasUsableForUid(uid: string | undefined): uid is string {
  return typeof uid === 'string' && uid.trim() !== '';
}

/** 读取平面法向（行 × 列）；方向向量退化/非有限时返回 null */
function planeNormal(geometry: SlicePlaneGeometry): Point3 | null {
  const { rowDir, colDir } = geometry;
  if (!isFinitePoint(rowDir) || !isFinitePoint(colDir)) {
    return null;
  }
  const normal = cross(rowDir, colDir);
  const length = norm(normal);
  if (!Number.isFinite(length) || length < EPSILON) {
    return null;
  }
  return normal;
}

/** 校验平面参数：UID、原点/方向、spacing、行列数均须合法 */
function isValidGeometry(geometry: SlicePlaneGeometry): boolean {
  if (!Number.isFinite(geometry.columns) || geometry.columns <= 0) {
    return false;
  }
  if (!Number.isFinite(geometry.rows) || geometry.rows <= 0) {
    return false;
  }
  if (
    !Number.isFinite(geometry.spacing[0]) ||
    !Number.isFinite(geometry.spacing[1]) ||
    geometry.spacing[0] <= 0 ||
    geometry.spacing[1] <= 0
  ) {
    return false;
  }
  if (!isFinitePoint(geometry.origin)) {
    return false;
  }
  return planeNormal(geometry) !== null;
}

/**
 * 计算「来源平面 ∩ 目标平面」在目标图像像素坐标内的单条线段。
 *
 * 推导：来源平面 n·(X − o_src)=0；目标平面上的点
 *   X(c,r) = o_tgt + c·sx·row + r·sy·col
 * 代入得 A·c + B·r = D：
 *   A = sx·(n·row)，B = sy·(n·col)，D = n·(o_src − o_tgt)
 * 直线方向 (B, −A)，锚点取 c0=D/A（或 r0=D/B）后按像素边界裁切。
 *
 * @returns 目标像素坐标内的线段；以下情况返回 null：
 *   - 任一侧 FrameOfReferenceUID 缺失或不同；
 *   - 两平面平行/重合（含同一序列同一层）；
 *   - 交线完全落在目标图像范围外；
 *   - 参数非法（NaN/Infinity、零法向、非正 spacing/行列数）。
 */
export function computeCrossReferenceSegment(
  source: SlicePlaneGeometry,
  target: SlicePlaneGeometry,
): LineSegment | null {
  if (!hasUsableForUid(source.frameOfReferenceUID)) {
    return null;
  }
  if (!hasUsableForUid(target.frameOfReferenceUID)) {
    return null;
  }
  if (source.frameOfReferenceUID !== target.frameOfReferenceUID) {
    return null;
  }
  if (!isValidGeometry(source) || !isValidGeometry(target)) {
    return null;
  }

  const sourceNormal = planeNormal(source);
  const targetNormal = planeNormal(target);
  if (sourceNormal === null || targetNormal === null) {
    return null;
  }

  // 平行/重合判定：单位法向叉积的模 = sin(夹角)
  const normalCross = cross(sourceNormal, targetNormal);
  const sinAngle = norm(normalCross) / (norm(sourceNormal) * norm(targetNormal));
  if (!Number.isFinite(sinAngle) || sinAngle < PARALLEL_SIN_EPSILON) {
    return null;
  }

  const { origin, rowDir, colDir, spacing, columns, rows } = target;
  const A = spacing[0] * dot(sourceNormal, rowDir);
  const B = spacing[1] * dot(sourceNormal, colDir);
  const D = dot(sourceNormal, sub(source.origin, origin));
  if (
    !Number.isFinite(A) ||
    !Number.isFinite(B) ||
    !Number.isFinite(D) ||
    (Math.abs(A) < EPSILON && Math.abs(B) < EPSILON)
  ) {
    return null;
  }

  // 精确锚点：优先取系数绝对值较大的轴，保证除法稳定
  const c0 = Math.abs(A) >= Math.abs(B) ? D / A : 0;
  const r0 = Math.abs(A) >= Math.abs(B) ? 0 : D / B;
  if (!Number.isFinite(c0) || !Number.isFinite(r0)) {
    return null;
  }

  const segment = clipLineToRect(c0, r0, B, -A, columns, rows);
  if (segment === null) {
    return null;
  }
  if (
    !Number.isFinite(segment.p1.x) ||
    !Number.isFinite(segment.p1.y) ||
    !Number.isFinite(segment.p2.x) ||
    !Number.isFinite(segment.p2.y)
  ) {
    return null;
  }
  return segment;
}
