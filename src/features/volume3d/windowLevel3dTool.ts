/**
 * 3D 专用窗宽窗位工具（M11-F5）。
 *
 * 根因（真机：中键拖动画面变化但面板 WW/WL 不动、元素上收不到
 * CORNERSTONE_VOI_MODIFIED）：Cornerstone3D 5.8.2 内核对 VOI 变更的事件派发
 * 不稳定——经典 BaseVolumeViewport.setVOI 会 triggerEvent(VOI_MODIFIED)
 * （BaseVolumeViewport.js:593-597），而 GenericViewport 架构的
 * VolumeViewport3DLegacyAdapter.setProperties（同版本
 * VolumeViewport3DLegacyAdapter.js:56-90）把 voiRange 写进 display-set
 * presentation，**不派发任何 VOI 事件**；运行时视口类取决于
 * config.rendering.useGenericViewport（init.js:164-165、
 * BaseRenderingEngine.js:183-188/338-345 的 VOLUME_3D→VOLUME_3D_NEXT 重映射）。
 *
 * 因此面板跟随不能依赖内核事件：本工具子类在每次 mouseDragCallback
 * （即拖动过程中的每个 pointermove 帧）调用内核逻辑生效新 VOI 后，
 * 直接从 viewport.getProperties().voiRange（经典与 Next 视口均同步暴露）
 * 读取最新映射范围，并向视口元素派发应用级自定义事件
 * VOLUME3D_VOI_CHANGED_EVENT，供 Volume3dViewport 面板实时跟随。
 * 拖动中逐帧派发（非 mouseup 才跳一次）；事件派发失败静默，
 * 不影响调窗本身生效。
 */
import { getEnabledElement } from '@cornerstonejs/core';
import { WindowLevelTool } from '@cornerstonejs/tools';

/** 应用级自定义事件：3D 视口 VOI（窗宽窗位）在拖动中变更 */
export const VOLUME3D_VOI_CHANGED_EVENT = 'dicomviewer:vol3d-voi-changed';

/** VOI 映射范围（lower/upper，HU） */
export interface VoiRangeLike {
  lower: number;
  upper: number;
}

/** VOLUME3D_VOI_CHANGED_EVENT 的 detail */
export interface Volume3dVoiChangedDetail {
  viewportId: string;
  /** 窗宽（upper - lower，保留 2 位小数） */
  ww: number;
  /** 窗位（(upper + lower) / 2，保留 2 位小数） */
  wl: number;
  /** 原始映射范围 */
  range: VoiRangeLike;
}

/** 由 VOI 映射范围换算 WW/WL（与面板 InfoOverlay 同一取整口径） */
export function wwWlFromVoiRange(range: VoiRangeLike): { ww: number; wl: number } {
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    ww: round(range.upper - range.lower),
    wl: round((range.upper + range.lower) / 2),
  };
}

/** 向视口元素派发 VOI 变更事件（面板监听此事件实时跟随） */
export function emitVolume3dVoiChanged(
  element: EventTarget,
  detail: Volume3dVoiChangedDetail,
): void {
  element.dispatchEvent(
    new CustomEvent<Volume3dVoiChangedDetail>(VOLUME3D_VOI_CHANGED_EVENT, {
      detail,
      cancelable: true,
    }),
  );
}

/**
 * WindowLevelTool 子类：内核调窗生效后补发应用级 VOI 变更事件。
 * toolName 与内建 WindowLevel 区分，避免全局工具表同名注册冲突
 * （2D/MPR 仍用内建 WindowLevelTool，互不影响）。
 */
export class WindowLevel3DTool extends WindowLevelTool {
  static override toolName = 'WindowLevel3D';

  override mouseDragCallback(evt: {
    detail: { element: HTMLDivElement; deltaPoints: { canvas: [number, number] } };
  }): void {
    try {
      // 内核逻辑：计算并应用新 voiRange（setProperties，同步生效）+ render
      super.mouseDragCallback(evt as never);
    } catch (error) {
      // 内核计算异常（volume 缺失等）：与内建行为一致中断本次拖动
      console.error('[WindowLevel3DTool] 拖动调窗失败', error);
      return;
    }
    try {
      const { element } = evt.detail;
      const viewport = getEnabledElement(element)?.viewport;
      const range = viewport?.getProperties?.()?.voiRange;
      if (
        !range ||
        !Number.isFinite(range.lower) ||
        !Number.isFinite(range.upper)
      ) {
        return;
      }
      const { ww, wl } = wwWlFromVoiRange(range);
      emitVolume3dVoiChanged(element, {
        viewportId: viewport?.id ?? '',
        ww,
        wl,
        range: { lower: range.lower, upper: range.upper },
      });
    } catch (error) {
      // 面板跟随失败不反向影响调窗（画面已生效）
      console.error('[WindowLevel3DTool] VOI 变更事件派发失败', error);
    }
  }
}
