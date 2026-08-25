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

const RENDERING_ENGINE_ID = 'dicom-viewer-m1-engine';
export const STACK_VIEWPORT_ID = 'dicom-viewer-vp-0';

/** 视口当前 UI 状态快照（供工具栏输入框/按钮同步显示） */
export interface ViewportUiState {
  sliceIndex: number;
  sliceCount: number;
  ww: number;
  wl: number;
}

/** 命令式视口操作接口（工具栏/快捷键入口） */
export interface ViewportApi {
  scrollSlice: (delta: number) => void;
  setImageIndex: (index: number) => void;
  setPrimaryTool: (toolName: string | null) => void;
}

interface DicomViewportProps {
  /** 待显示的 imageId 列表（堆栈）；空数组表示空态 */
  imageIds: string[];
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

export function DicomViewport({ imageIds, onApiReady, onUiChange }: DicomViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Types.IStackViewport | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [uiState, setUiState] = useState<ViewportUiState>({
    sliceIndex: 0,
    sliceCount: 0,
    ww: 0,
    wl: 0,
  });

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
        viewport.render();
        if (cancelled) {
          return;
        }
        setRenderError(null);
        publishUi({
          sliceCount: imageIds.length,
          sliceIndex: viewport.getCurrentImageIdIndex(),
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

  // 视口事件订阅：翻页滚动 → 层号；VOI 变化 → WW/WL
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
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onScroll);
    element.addEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    return () => {
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onScroll);
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
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
