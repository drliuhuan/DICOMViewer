/**
 * 视图变换纯逻辑（FR-3.10 旋转 + FR-4.10 方向标记随动，M10-E）。
 *
 * Cornerstone 旋转约定（按 d.ts/源码推导）：StackViewport.getRotation() 返回
 * viewUp 绕 viewPlaneNormal 的右手定则角（getRotationGPU 依 cross(adjustedViewUp,
 * currentViewUp)·viewPlaneNormal 定号），正值 = 图像在屏幕上**逆时针**旋转。
 * 因此：
 * - 「逆时针旋转」按钮 → rotation += 90（setRotation 值变大）；
 * - 「顺时针旋转」按钮 → rotation -= 90。
 * 方向标记（FR-4.10）随同一 rotation 值逆时针平移，保证与画面旋转完全一致。
 *
 * 全部纯函数，可在 Node 下单测。
 */
import type { OrientationLabel, OrientationMarkers } from './orientation';

/** 旋转步进（°）：90° 步进（FR-3.10） */
export const ROTATION_STEP_DEGREES = 90;

/** 度数收敛到 [0°, 360°) */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** 在当前旋转值上叠加增量（正 = 逆时针），返回归一化后的新旋转值 */
export function addRotation(currentDegrees: number, delta: number): number {
  return normalizeRotation(currentDegrees + delta);
}

/**
 * 方向标记随视图旋转更新。
 *
 * @param markers 未旋转时的边缘标签（computeOrientationMarkers 输出）
 * @param rotationDegrees 当前视图旋转值（正 = 逆时针，与 setRotation 同号）
 *
 * 每 90° 逆时针：top←left、right←top、bottom←right、left←bottom。
 * 360° 返回原样（返回同一引用，避免无谓 re-render 差异）。
 */
export function rotateOrientationMarkers(
  markers: OrientationMarkers,
  rotationDegrees: number,
): OrientationMarkers {
  const steps =
    (((Math.round(rotationDegrees) / ROTATION_STEP_DEGREES) % 4) + 4) % 4;
  if (steps === 0) {
    return markers;
  }
  const order: ReadonlyArray<keyof OrientationMarkers> = [
    'top',
    'right',
    'bottom',
    'left',
  ];
  let values: OrientationLabel[] = order.map((key) => markers[key]);
  for (let step = 0; step < steps; step += 1) {
    values = [values[3]!, values[0]!, values[1]!, values[2]!];
  }
  const rotated = {} as OrientationMarkers;
  order.forEach((key, index) => {
    rotated[key] = values[index]!;
  });
  return rotated;
}