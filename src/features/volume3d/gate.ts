/**
 * 3D 体绘制数据门槛与能力判定（FR-7.1 数据门槛，同类 FR-6.7）。
 *
 * - 数据门槛复用 MPR 的 mprGate（体绘制与 MPR 同为 volume 构建，
 *   层数 < 2 / 缺像素间距 / 缺 IPP 均无法构建体数据）；
 * - 能力门槛：3D 体绘制依赖 WebGL2 光线投射，缺失时禁用入口并提示。
 *
 * 全部为纯函数 + 可注入依赖，Node 单测安全。
 */
import type { SeriesStack } from '../series/buildStacks';
import { checkMprEligibility, type MprGateReason, type MprGateResult } from '../mpr/mprGate';

export type Volume3dGateReason = 'NO_SERIES' | 'DATA_NOT_READY' | 'NO_WEBGL2';

export interface Volume3dGateResult {
  /** 是否允许进入 3D */
  allowed: boolean;
  /** 不允许时的原因代号 */
  reason?: Volume3dGateReason;
  /** 用户可读提示（简体中文） */
  message?: string;
  /** 底层数据门槛结果（层数/间距等，供 UI 显示） */
  data: MprGateResult;
  /** WebGL2 是否可用 */
  webgl2: boolean;
}

export interface WebGl2DetectDeps {
  /** 创建一个 canvas 元素；默认 document.createElement */
  createCanvas?: () => { getContext: (type: string) => unknown } | null;
}

/**
 * 检测 WebGL2 是否可用（FR-7.1 能力门槛）。
 * jsdom 环境 getContext 返回 null → 返回 false，可单测。
 */
export function hasWebGL2(deps: WebGl2DetectDeps = {}): boolean {
  const createCanvas = deps.createCanvas ?? (() => {
    if (typeof document === 'undefined') {
      return null;
    }
    return document.createElement('canvas');
  });
  try {
    const canvas = createCanvas();
    if (!canvas) {
      return false;
    }
    const gl = canvas.getContext('webgl2');
    return gl !== null && gl !== undefined;
  } catch {
    return false;
  }
}

/**
 * 重探 WebGL2（M11 任务 2）：仅当当前不可用时重新检测。
 *
 * 背景（「点击 3D 无任何反应」根因之一）：App 在首次渲染时一次性探测
 * WebGL2 并永久缓存——应用启动早期 GPU 进程繁忙/上下文暂不可用时
 * 得到 false，之后不再重试，3D 入口按钮被静默禁用且只有悬停提示，
 * 点击既无报错也无界面变化。改为点击时/聚焦时重探即可恢复。
 */
export function refreshWebGL2(current: boolean): boolean {
  return current ? true : hasWebGL2();
}

/**
 * 3D 体绘制门槛判定：先看数据（同 MPR，volume 构建所需），
 * 再看 WebGL2。任一不满足即禁用并给出原因提示。
 */
export function checkVolume3dEligibility(
  stack: SeriesStack | null,
  webgl2: boolean = hasWebGL2(),
): Volume3dGateResult {
  const data = checkMprEligibility(stack);
  if (!data.allowed) {
    const message = volume3dDataReasonMessage(data.reason, data.message);
    return { allowed: false, reason: 'DATA_NOT_READY', message, data, webgl2 };
  }
  if (!webgl2) {
    return {
      allowed: false,
      reason: 'NO_WEBGL2',
      message: '当前浏览器不支持 WebGL2，无法进行 3D 体绘制',
      data,
      webgl2: false,
    };
  }
  return { allowed: true, data, webgl2 };
}

/** 数据门槛原因 → 3D 体绘制中文提示（把 MPR 文案改写为 3D 语境） */
export function volume3dDataReasonMessage(
  reason: MprGateReason | undefined,
  fallback?: string,
): string | undefined {
  switch (reason) {
    case 'NO_SERIES':
      return '请先在视口中加载序列';
    case 'TOO_FEW_SLICES':
      return '3D 体绘制需要至少 2 层图像';
    case 'MISSING_PIXEL_SPACING':
      return '序列缺少像素间距，无法进行 3D 体绘制';
    case 'MISSING_IPP':
      return '存在缺少图像位置（IPP）的帧，无法进行 3D 体绘制';
    default:
      return fallback ?? '数据不满足 3D 体绘制要求';
  }
}