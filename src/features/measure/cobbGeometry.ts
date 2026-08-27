/**
 * Cobb 角几何计算（M11 任务 3，纯函数）。
 *
 * Cobb 角语义：两条线段的延长线交角，θ ∈ [0, 180)；医学显示约定
 * 钝角取其补角（显示 min(θ, 180 − θ)），与垂直脊柱侧弯测量惯例一致。
 *
 * 独立实现一份参考计算（供 UI 展示/SR 导出/单测复用），与
 * @cornerstonejs/tools 内置 angleBetweenLines 的方向无关角互补对齐：
 * 内置给出 θ∈[0,180]，这里再给出「显示角」与其换算规则。
 */

export interface Point2Like {
  x: number;
  y: number;
}

export interface Point3Like extends Array<number> {
  // [x, y, z] 世界坐标（cornerstone 句柄点）
}

/** 点积夹角：θ∈[0,180)，零向量/非有限输入返回 null */
export function angleBetweenSegmentsDeg(
  a1: readonly number[] | undefined,
  a2: readonly number[] | undefined,
  b1: readonly number[] | undefined,
  b2: readonly number[] | undefined,
): number | null {
  if (
    !a1 ||
    !a2 ||
    !b1 ||
    !b2 ||
    a1.length < 2 ||
    a2.length < 2 ||
    b1.length < 2 ||
    b2.length < 2
  ) {
    return null;
  }
  const dim = Math.min(a1.length, a2.length, b1.length, b2.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < dim; index++) {
    const da = (a2[index] ?? 0) - (a1[index] ?? 0);
    const db = (b2[index] ?? 0) - (b1[index] ?? 0);
    if (!Number.isFinite(da) || !Number.isFinite(db)) {
      return null;
    }
    dot += da * db;
    normA += da * da;
    normB += db * db;
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return null; // 任一线段长度为 0 → 无方向，角度无意义
  }
  const cosine = clamp(dot / magnitude, -1, 1);
  const degrees = (Math.acos(cosine) * 180) / Math.PI;
  return Number.isFinite(degrees) ? degrees : null;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}

/** 医学 Cobb 显示值：钝角取补角，θ∈[0,90] 原样显示；θ 为 null 时返回 null */
export function cobbDisplayValue(angleDeg: number | null): number | null {
  if (angleDeg === null || !Number.isFinite(angleDeg)) {
    return null;
  }
  const normalized = ((angleDeg % 360) + 360) % 360;
  const folded = normalized > 180 ? 360 - normalized : normalized;
  return folded > 90 ? Number((180 - folded).toFixed(4)) : folded;
}

/** 世界坐标两点距离（patient 空间即物理 mm） */
export function distanceWorld(
  p1: readonly number[] | undefined,
  p2: readonly number[] | undefined,
): number | null {
  if (!p1 || !p2 || p1.length < 2 || p2.length < 2) {
    return null;
  }
  const dim = Math.min(p1.length, p2.length);
  let sum = 0;
  for (let index = 0; index < dim; index++) {
    const delta = (p2[index] ?? 0) - (p1[index] ?? 0);
    if (!Number.isFinite(delta)) {
      return null;
    }
    sum += delta * delta;
  }
  return Number.isFinite(sum) ? Math.sqrt(sum) : null;
}

/** 两线段统计富集结果 */
export interface CobbSegmentStats {
  /** 内置方向无关角 θ∈[0,180) */
  rawAngle: number | null;
  /** 医学显示角（钝角取补角） */
  displayAngle: number | null;
  /** 线段 A 物理长度（mm） */
  lineALengthMm: number | null;
  /** 线段 B 物理长度（mm） */
  lineBLengthMm: number | null;
}

/**
 * 由四个句柄点计算两线段统计。
 * handles 点不足 4 个时各字段为 null（绘制中间态由调用方跳过展示）。
 */
export function computeCobbSegmentStats(
  points: ReadonlyArray<readonly number[]> | undefined,
): CobbSegmentStats {
  const empty: CobbSegmentStats = {
    rawAngle: null,
    displayAngle: null,
    lineALengthMm: null,
    lineBLengthMm: null,
  };
  if (!points || points.length < 4) {
    return empty;
  }
  const [p0, p1, p2, p3] = points;
  const rawAngle = angleBetweenSegmentsDeg(p0, p1, p2, p3);
  return {
    rawAngle,
    displayAngle: cobbDisplayValue(rawAngle),
    lineALengthMm: distanceWorld(p0, p1),
    lineBLengthMm: distanceWorld(p2, p3),
  };
}

/**
 * 无限线交点（2D 投影）：用于把 Cobb 四点映射到 SR 的三点半角表示。
 * 平行/共线（分母近似 0）返回 null，调用方应跳过该条 SR 测量。
 */
export function intersectInfiniteLines(
  a1: readonly number[],
  a2: readonly number[],
  b1: readonly number[],
  b2: readonly number[],
): Point2Like | null {
  const dax = (a2[0] ?? 0) - (a1[0] ?? 0);
  const day = (a2[1] ?? 0) - (a1[1] ?? 0);
  const dbx = (b2[0] ?? 0) - (b1[0] ?? 0);
  const dby = (b2[1] ?? 0) - (b1[1] ?? 0);
  const denominator = dax * dby - day * dbx;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
    return null; // 平行或共线
  }
  const t =
    (((b1[0] ?? 0) - (a1[0] ?? 0)) * dby - ((b1[1] ?? 0) - (a1[1] ?? 0)) * dbx) /
    denominator;
  return { x: (a1[0] ?? 0) + t * dax, y: (a1[1] ?? 0) + t * day };
}

/** 端点到给定点距离平方（选远端用） */
function distance2To(point: readonly number[], target: Point2Like): number {
  const dx = (point[0] ?? 0) - target.x;
  const dy = (point[1] ?? 0) - target.y;
  return dx * dx + dy * dy;
}

/**
 * Cobb 标注 → 三点半角端点选择：交点为顶点，A/B 各自离顶点最远的端点
 * 作为 start/end（两线夹角的直观楔形）。点位不足/平行时返回 null。
 */
export function cobbEndpointsForSr(
  points: ReadonlyArray<readonly number[]> | undefined,
): { start: Point2Like; middle: Point2Like; end: Point2Like } | null {
  if (!points || points.length < 4) {
    return null;
  }
  const [p0, p1, p2, p3] = points;
  const apex = intersectInfiniteLines(p0!, p1!, p2!, p3!);
  if (apex === null) {
    return null;
  }
  const start = distance2To(p0!, apex) >= distance2To(p1!, apex) ? p0! : p1!;
  const end = distance2To(p2!, apex) >= distance2To(p3!, apex) ? p2! : p3!;
  return {
    start: { x: start[0] ?? 0, y: start[1] ?? 0 },
    middle: apex,
    end: { x: end[0] ?? 0, y: end[1] ?? 0 },
  };
}
