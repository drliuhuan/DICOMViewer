/**
 * 解剖方向标记计算（FR-4.10）。
 *
 * 基于 ImageOrientationPatient (0020,0037)：
 *   [rowX,rowY,rowZ]  = 沿图像行方向（屏幕上列索引增大 → 视口右方）的方向余弦
 *   [colX,colY,colZ]  = 沿图像列方向（屏幕上行索引增大 → 视口下方）的方向余弦
 *
 * DICOM 病人体坐标系：+x=患者左(L)，+y=患者后(P)，+z=患者头侧(S)。
 * 取各方向余弦绝对值最大的轴并按符号标注：
 *   视口右缘 = row 方向；左缘取反；下缘 = column 方向；上缘取反。
 *
 * 斜行扫描（无单一主导轴）返回 null（不显示标记）。
 * 全部纯函数，可在 Node 下单测。
 */

export type OrientationLabel = 'L' | 'R' | 'A' | 'P' | 'S' | 'I';

export interface OrientationMarkers {
  top: OrientationLabel;
  bottom: OrientationLabel;
  left: OrientationLabel;
  right: OrientationLabel;
}

/** 轴 → 正方向标签（DICOM Patient Orientation 惯例） */
const POSITIVE_LABEL: readonly ('L' | 'P' | 'S')[] = ['L', 'P', 'S'];
const NEGATIVE_LABEL: readonly ('R' | 'A' | 'I')[] = ['R', 'A', 'I'];

/** 主导轴权重需达到的比例（低于此值视为斜行，不显示） */
const DOMINANCE_RATIO = 0.9;

function dominantAxis(vector: number[]): number | null {
  let maxIndex = -1;
  let maxValue = 0;
  for (let i = 0; i < vector.length && i < 3; i++) {
    const abs = Math.abs(vector[i] ?? 0);
    if (abs > maxValue) {
      maxValue = abs;
      maxIndex = i;
    }
  }
  if (maxIndex < 0 || maxValue === 0) {
    return null;
  }
  // 其余分量过小说明接近正交轴；否则为斜行方向
  const sumOthers = vector
    .slice(0, 3)
    .reduce((sum, v, i) => (i === maxIndex ? sum : sum + Math.abs(v ?? 0)), 0);
  if (maxValue < DOMINANCE_RATIO * (maxValue + sumOthers)) {
    return null;
  }
  return maxIndex;
}

function labelForVector(vector: number[]): OrientationLabel | null {
  const axis = dominantAxis(vector);
  if (axis === null) {
    return null;
  }
  const value = vector[axis] ?? 0;
  const positive = POSITIVE_LABEL[axis];
  const negative = NEGATIVE_LABEL[axis];
  if (positive === undefined || negative === undefined) {
    return null;
  }
  return value >= 0 ? positive : negative;
}

/**
 * 由 ImageOrientationPatient 计算视口边缘方向标签。
 * @param iop 六元组方向余弦（缺失或非法时返回 null）
 */
export function computeOrientationMarkers(
  iop: readonly number[] | undefined | null,
): OrientationMarkers | null {
  if (!iop || iop.length < 6) {
    return null;
  }
  const row = [iop[0] ?? 0, iop[1] ?? 0, iop[2] ?? 0];
  const col = [iop[3] ?? 0, iop[4] ?? 0, iop[5] ?? 0];
  const right = labelForVector(row);
  const bottom = labelForVector(col);
  if (right === null || bottom === null) {
    return null;
  }
  const opposite: Record<OrientationLabel, OrientationLabel> = {
    L: 'R',
    R: 'L',
    A: 'P',
    P: 'A',
    S: 'I',
    I: 'S',
  };
  return {
    top: opposite[bottom],
    bottom,
    left: opposite[right],
    right,
  };
}
