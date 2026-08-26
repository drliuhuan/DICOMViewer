/**
 * MPR 数据门槛判定（FR-6.7，M10-B）。
 *
 * 纯函数：输入序列堆栈（含逐层元数据）→ 输出是否允许进入 MPR 及原因。
 * - 层数 < 2 → 禁用，提示「至少 2 层」；
 * - 无像素间距 / 像素间距 ≤ 0 → 禁用；
 * - 任一层缺少 ImagePositionPatient（IPP）→ 禁用；
 * - 层间距不一致 → 允许，但提示「按 IPP 重采样」。
 *
 * 层间距差计算：各帧 IPP 沿切片法向量（IOP 叉积，缺 IOP 时回退 +z 轴）
 * 的投影，取相邻投影差作为层距；最大最小层距偏差超过容差即视为不均匀。
 * 增强型多帧（perFrameImagePositions）按帧取 IPP，非增强多帧/单帧取实例 IPP。
 */
import type { SeriesStack } from '../series/buildStacks';

export type MprGateReason =
  | 'NO_SERIES'
  | 'TOO_FEW_SLICES'
  | 'MISSING_PIXEL_SPACING'
  | 'MISSING_IPP';

export interface MprGateResult {
  /** 是否允许进入 MPR */
  allowed: boolean;
  /** 不允许时的原因代号 */
  reason?: MprGateReason;
  /** 用户可读提示（简体中文，禁用原因或重采样提示） */
  message?: string;
  /** 层间距是否不一致（true 时允许但提示按 IPP 重采样） */
  nonUniformSpacing: boolean;
  /** 层数（items 长度） */
  sliceCount: number;
  /** 平均层间距（mm）；无法计算时为 null */
  zSpacing: number | null;
}

/** 相邻层距差超过该绝对容差（mm）即视为层间距不均匀 */
const SPACING_EPSILON = 1e-3;

/**
 * 取堆栈条目对应的帧空间位置（FR-6.7 / FR-audit 5.1-3）。
 * 增强型多帧：perFrameImagePositions[frameNumber-1]；
 * 否则回退实例级 imagePositionPatient。
 */
export function frameImagePosition(
  item: Readonly<{
    frameNumber: number;
    summary: Readonly<{
      numberOfFrames: number;
      perFrameImagePositions?: Array<[number, number, number]> | undefined;
      imagePositionPatient?: [number, number, number] | undefined;
    }>;
  }>,
): [number, number, number] | undefined {
  const perFrame = item.summary.perFrameImagePositions;
  if (perFrame !== undefined && perFrame.length === item.summary.numberOfFrames) {
    return perFrame[item.frameNumber - 1];
  }
  return item.summary.imagePositionPatient;
}

/** 切片法向量：IOP 行/列余弦叉积；缺 IOP 时回退 +z 轴（轴位近似） */
function sliceNormal(
  iop: readonly number[] | undefined,
): [number, number, number] {
  if (iop === undefined || iop.length < 6) {
    return [0, 0, 1];
  }
  const row = [iop[0] ?? 0, iop[1] ?? 0, iop[2] ?? 0];
  const column = [iop[3] ?? 0, iop[4] ?? 0, iop[5] ?? 0];
  return [
    row[1]! * column[2]! - row[2]! * column[1]!,
    row[2]! * column[0]! - row[0]! * column[2]!,
    row[0]! * column[1]! - row[1]! * column[0]!,
  ];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

/**
 * 各帧 IPP 沿切片法向量投影（与 buildStacks.sliceProjection 语义一致，
 * 但按帧 IPP 计算，用于层间距一致性判定）。
 */
function frameProjections(stack: SeriesStack): number[] {
  const normal = sliceNormal(stack.items[0]?.summary.imageOrientationPatient);
  const projections: number[] = [];
  for (const item of stack.items) {
    const ipp = frameImagePosition(item);
    if (ipp === undefined) {
      continue;
    }
    projections.push(dot(ipp, normal));
  }
  return projections;
}

/** 逐层距取平均得到平均 z 间距；不足 2 层或出现负距返回 null */
function meanZSpacing(stack: SeriesStack): number | null {
  const projections = frameProjections(stack);
  if (projections.length < 2) {
    return null;
  }
  const sorted = [...projections].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i]! - sorted[i - 1]!);
  }
  const positive = gaps.filter((gap) => gap > 0);
  if (positive.length === 0) {
    return null;
  }
  return positive.reduce((sum, gap) => sum + gap, 0) / positive.length;
}

/**
 * MPR 数据门槛判定（FR-6.7）。
 * @param stack 序列堆栈；null 表示尚无加载的序列
 */
export function checkMprEligibility(stack: SeriesStack | null): MprGateResult {
  if (stack === null) {
    return {
      allowed: false,
      reason: 'NO_SERIES',
      message: '请先在视口中加载序列',
      nonUniformSpacing: false,
      sliceCount: 0,
      zSpacing: null,
    };
  }

  const sliceCount = stack.items.length;
  if (sliceCount < 2) {
    return {
      allowed: false,
      reason: 'TOO_FEW_SLICES',
      message: 'MPR 需要至少 2 层图像，当前仅 1 层',
      nonUniformSpacing: false,
      sliceCount,
      zSpacing: meanZSpacing(stack),
    };
  }

  const first = stack.items[0]?.summary;
  const pixelSpacing = first?.pixelSpacing;
  if (
    pixelSpacing === undefined ||
    pixelSpacing[0] === 0 ||
    pixelSpacing[1] === 0 ||
    !Number.isFinite(pixelSpacing[0]) ||
    !Number.isFinite(pixelSpacing[1])
  ) {
    return {
      allowed: false,
      reason: 'MISSING_PIXEL_SPACING',
      message: '序列缺少像素间距，无法进行 MPR 重建',
      nonUniformSpacing: false,
      sliceCount,
      zSpacing: meanZSpacing(stack),
    };
  }

  for (const item of stack.items) {
    if (frameImagePosition(item) === undefined) {
      return {
        allowed: false,
        reason: 'MISSING_IPP',
        message: '存在缺少图像位置（IPP）的帧，无法进行 MPR 重建',
        nonUniformSpacing: false,
        sliceCount,
        zSpacing: meanZSpacing(stack),
      };
    }
  }

  // 层间距一致性：逐层距是否基本相等（FR-6.7 非均匀 → 按 IPP 重采样并提示）
  let nonUniformSpacing = false;
  const zSpacing = meanZSpacing(stack);
  if (zSpacing !== null) {
    const projections = frameProjections(stack).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < projections.length; i++) {
      const gap = projections[i]! - projections[i - 1]!;
      if (gap > 0) {
        gaps.push(gap);
      }
    }
    if (gaps.length > 1) {
      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      nonUniformSpacing = max - min > SPACING_EPSILON;
    }
  }

  return {
    allowed: true,
    nonUniformSpacing,
    message: nonUniformSpacing
      ? '层间距不一致，已按图像位置（IPP）重采样'
      : undefined,
    sliceCount,
    zSpacing,
  };
}