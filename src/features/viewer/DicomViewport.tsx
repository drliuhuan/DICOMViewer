/**
 * M1 视口组件：Cornerstone3D StackViewport + @cornerstonejs/tools 工具绑定。
 *
 * - 挂载期创建共享渲染引擎上的视口与专属 ToolGroup（滚轮翻页/Ctrl+滚轮缩放/
 *   中键平移/左键窗宽窗位，见 toolSetup.ts）；
 * - 堆栈变化时 setStack 并同步层数状态；
 * - 订阅 STACK_VIEWPORT_SCROLL / VOI_MODIFIED 事件，驱动层滑块与 WW/WL 显示；
 * - 通过 onApiReady 上报命令式操作接口，供工具栏与全局快捷键调用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Enums, RenderingEngine, getRenderingEngine, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import {
  createBoundToolGroup,
  destroyBoundToolGroup,
  initializeTools,
  syncToolBindings,
} from './toolSetup';
import { voiRangeFromWwWl } from './wwPresets';

const RENDERING_ENGINE_ID = 'dicom-viewer-m1-engine';
export const STACK_VIEWPORT_ID = 'dicom-viewer-vp-0';

/** 缩放下限（parallelScale 最小值，世界 mm），防止过度放大后除零/翻转 */
const MIN_PARALLEL_SCALE = 1e-3;

/** 视口当前 UI 状态快照（供工具栏输入框/按钮同步显示） */
export interface ViewportUiState {
  sliceIndex: number;
  sliceCount: number;
  ww: number;
  wl: number;
  /** 相对适应窗口基线的缩放比例（1 ≈ 适应窗口） */
  zoom: number;
}

/** 命令式视口操作接口（工具栏/快捷键入口） */
export interface ViewportApi {
  scrollSlice: (delta: number) => void;
  setImageIndex: (index: number) => void;
  setPrimaryTool: (toolName: string | null) => void;
  /** 应用窗宽窗位（FR-3.2 输入框 / FR-3.3 预设） */
  applyWwWl: (ww: number, wl: number) => void;
  /** 恢复默认窗宽窗位（FR-3.4） */
  resetWindowLevel: () => void;
  /** 缩放一步：factor > 1 放大，< 1 缩小（FR-3.5） */
  zoomStep: (factor: number) => void;
  /** 1:1 原始像素显示（FR-3.5） */
  oneToOne: () => void;
  /** 适应窗口（FR-3.4 双击 / FR-11 F 键） */
  fitToWindow: () => void;
  /** 全局视图重置：WW/WL + 缩放 + 平移（FR-3.11，Shift+R） */
  resetView: () => void;
}

interface DicomViewportProps {
  /** 待显示的 imageId 列表（堆栈）；空数组表示空态 */
  imageIds: string[];
  /** 该堆栈的默认窗宽窗位（文件自带值优先，其次模态预设） */
  defaultWwWl?: { ww: number; wl: number };
  /** 视口就绪后上报命令式 API（仅首次） */
  onApiReady?: (api: ViewportApi) => void;
  /** UI 状态变化回调（层号 / 窗宽窗位） */
  onUiChange?: (ui: ViewportUiState) => void;
}

/** 取应用级单例渲染引擎（生命周期 = 应用，视口随组件挂载/卸载启用/禁用） */
function getSharedRenderingEngine(): RenderingEngine {
  return (
    getRenderingEngine(RENDERING_ENGINE_ID) ??
    new RenderingEngine(RENDERING_ENGINE_ID)
  );
}

function voiToWwWl(range: Types.VOIRange | undefined): { ww: number; wl: number } {
  if (!range) {
    return { ww: 0, wl: 0 };
  }
  return {
    ww: Math.round((range.upper - range.lower) * 100) / 100,
    wl: Math.round(((range.upper + range.lower) / 2) * 100) / 100,
  };
}

export function DicomViewport({
  imageIds,
  defaultWwWl,
  onApiReady,
  onUiChange,
}: DicomViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Types.IStackViewport | null>(null);
  const defaultWwWlRef = useRef<{ ww: number; wl: number } | undefined>(defaultWwWl);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [uiState, setUiState] = useState<ViewportUiState>({
    sliceIndex: 0,
    sliceCount: 0,
    ww: 0,
    wl: 0,
    zoom: 1,
  });

  // 默认窗宽窗位变化时保持 ref 同步（供 API 回调读取最新值）
  useEffect(() => {
    defaultWwWlRef.current = defaultWwWl;
  }, [defaultWwWl]);

  const publishUi = useCallback(
    (partial: Partial<ViewportUiState>) => {
      setUiState((prev) => {
        const next = { ...prev, ...partial };
        onUiChange?.(next);
        return next;
      });
    },
    [onUiChange],
  );

  // 挂载期：初始化工具管线 + 启用视口 + 创建 ToolGroup；卸载期清理
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    let toolGroup: ReturnType<typeof createBoundToolGroup> | null = null;
    let disposed = false;

    void initializeTools().then(() => {
      if (disposed) {
        return;
      }
      const renderingEngine = getSharedRenderingEngine();
      renderingEngine.enableElement({
        viewportId: STACK_VIEWPORT_ID,
        element,
        type: Enums.ViewportType.STACK,
        defaultOptions: { background: [0, 0, 0] },
      });
      const viewport =
        renderingEngine.getViewport<Types.IStackViewport>(STACK_VIEWPORT_ID);
      viewportRef.current = viewport;
      toolGroup = createBoundToolGroup(RENDERING_ENGINE_ID, STACK_VIEWPORT_ID);

      onApiReady?.({
        scrollSlice: (delta) => {
          const vp = viewportRef.current;
          if (vp) {
            utilities.scroll(vp, { delta });
          }
        },
        setImageIndex: (index) => {
          void viewportRef.current?.setImageIdIndex(index);
        },
        setPrimaryTool: (toolName) => {
          if (toolGroup) {
            syncToolBindings(toolGroup, toolName);
          }
        },
        applyWwWl: (ww, wl) => {
          const vp = viewportRef.current;
          if (!vp || !Number.isFinite(ww) || ww <= 0 || !Number.isFinite(wl)) {
            return;
          }
          vp.setProperties({ voiRange: voiRangeFromWwWl(ww, wl) });
          vp.render();
        },
        resetWindowLevel: () => {
          const vp = viewportRef.current;
          const fallback = defaultWwWlRef.current;
          if (!vp || !fallback) {
            return;
          }
          vp.setProperties({ voiRange: voiRangeFromWwWl(fallback.ww, fallback.wl) });
          vp.render();
        },
        zoomStep: (factor) => {
          const vp = viewportRef.current;
          if (!vp || !Number.isFinite(factor) || factor <= 0) {
            return;
          }
          const parallelScale = vp.getCamera().parallelScale;
          if (typeof parallelScale !== 'number' || !Number.isFinite(parallelScale)) {
            return;
          }
          vp.setCamera({
            parallelScale: Math.max(parallelScale / factor, MIN_PARALLEL_SCALE),
          });
          vp.render();
        },
        oneToOne: () => {
          const vp = viewportRef.current;
          if (!vp) {
            return;
          }
          // 1:1：屏幕一个 CSS 像素对应一个图像像素。
          // 平行投影下 parallelScale（世界 mm）= 视口高 px × 行间距 mm / 2
          const imageData = vp.getImageData();
          if (!imageData) {
            return;
          }
          const spacingY = imageData.spacing[1] ?? 1;
          const clientHeight = vp.element?.clientHeight ?? 0;
          if (clientHeight <= 0) {
            return;
          }
          const desired = (clientHeight * spacingY) / 2;
          vp.setCamera({
            parallelScale: Math.max(desired, MIN_PARALLEL_SCALE),
          });
          vp.render();
        },
        fitToWindow: () => {
          const vp = viewportRef.current;
          vp?.resetCamera({ resetPan: true, resetZoom: true });
          vp?.render();
        },
        resetView: () => {
          const vp = viewportRef.current;
          if (!vp) {
            return;
          }
          const fallback = defaultWwWlRef.current;
          if (fallback) {
            vp.setProperties({ voiRange: voiRangeFromWwWl(fallback.ww, fallback.wl) });
          }
          vp.resetCamera({ resetPan: true, resetZoom: true });
          vp.render();
        },
      });
    });

    return () => {
      disposed = true;
      viewportRef.current = null;
      if (toolGroup) {
        destroyBoundToolGroup(toolGroup);
      }
      getSharedRenderingEngine().disableElement(STACK_VIEWPORT_ID);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 堆栈变化时加载并渲染；同步层数与初始 WW/WL
  useEffect(() => {
    if (imageIds.length === 0) {
      setRenderError(null);
      publishUi({ sliceIndex: 0, sliceCount: 0 });
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const viewport = viewportRef.current;
        if (!viewport) {
          throw new Error('渲染引擎尚未就绪');
        }
        await viewport.setStack(imageIds);
        // 默认窗宽窗位：文件自带值优先（defaultWwWl 已在 App 计算），否则模态预设
        const fallback = defaultWwWlRef.current;
        if (fallback) {
          viewport.setProperties({ voiRange: voiRangeFromWwWl(fallback.ww, fallback.wl) });
        }
        viewport.render();
        if (cancelled) {
          return;
        }
        setRenderError(null);
        publishUi({
          sliceCount: imageIds.length,
          sliceIndex: viewport.getCurrentImageIdIndex(),
          zoom: 1,
          ...voiToWwWl(viewport.getProperties().voiRange),
        });
      } catch (error) {
        console.error('[DicomViewport] 显示失败', error);
        if (!cancelled) {
          setRenderError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageIds, publishUi]);

  // 视口事件订阅：翻页滚动 → 层号；VOI 变化 → WW/WL；相机变化 → 缩放比例；
  // 双击 → 适应窗口（FR-3.4/FR-14.1 桌面语义）
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const onScroll = (event: Event) => {
      const detail = (event as CustomEvent<Types.EventTypes.StackViewportScrollEventDetail>)
        .detail;
      publishUi({ sliceIndex: detail.newImageIdIndex });
    };
    const onVoiModified = (event: Event) => {
      const detail = (event as CustomEvent<Types.EventTypes.VoiModifiedEventDetail>).detail;
      if (detail.viewportId !== STACK_VIEWPORT_ID) {
        return;
      }
      publishUi(voiToWwWl(detail.range));
    };
    const syncZoom = () => {
      const vp = viewportRef.current;
      if (vp) {
        publishUi({ zoom: Math.round(vp.getZoom() * 100) / 100 });
      }
    };
    const onDoubleClick = () => {
      const vp = viewportRef.current;
      if (vp) {
        vp.resetCamera({ resetPan: true, resetZoom: true });
        vp.render();
        syncZoom();
      }
    };
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onScroll);
    element.addEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, syncZoom);
    element.addEventListener('dblclick', onDoubleClick);
    return () => {
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onScroll);
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, syncZoom);
      element.removeEventListener('dblclick', onDoubleClick);
    };
  }, [publishUi]);

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const index = Number(event.target.value);
    publishUi({ sliceIndex: index });
    void viewportRef.current?.setImageIdIndex(index);
  };

  const canSlide = uiState.sliceCount > 1;

  return (
    <div className="viewport-container">
      <div className="cornerstone-element" ref={containerRef} />
      {renderError !== null && (
        <div role="alert" className="viewport-error">
          图像显示失败：{renderError}
        </div>
      )}
      {canSlide && (
        <div className="slice-control">
          <span className="slice-indicator">
            第 {uiState.sliceIndex + 1} / {uiState.sliceCount} 层
          </span>
          <input
            type="range"
            className="slice-slider"
            min={0}
            max={uiState.sliceCount - 1}
            step={1}
            value={Math.min(uiState.sliceIndex, uiState.sliceCount - 1)}
            onChange={handleSliderChange}
            aria-label="层滑块"
          />
        </div>
      )}
    </div>
  );
}
