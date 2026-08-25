/**
 * M1 视口组件：Cornerstone3D StackViewport + @cornerstonejs/tools 工具绑定
 * + 信息覆盖文字与像素探针。
 *
 * - 挂载期创建共享渲染引擎上的视口与专属 ToolGroup（滚轮翻页/Ctrl+滚轮缩放/
 *   中键平移/左键窗宽窗位，见 toolSetup.ts）；
 * - 堆栈变化时 setStack、应用默认窗宽窗位并同步层数状态；
 * - 订阅 STACK_VIEWPORT_SCROLL / VOI_MODIFIED / CAMERA_MODIFIED 事件，
 *   驱动层滑块、WW/WL 输入框与缩放比例显示；
 * - 光标移动时采样像素值（经 Modality LUT 显示 HU，FR-4.5）；
 * - 通过 onApiReady 上报命令式操作接口，供工具栏与全局快捷键调用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Enums, RenderingEngine, cache, getRenderingEngine, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import {
  createBoundToolGroup,
  destroyBoundToolGroup,
  initializeTools,
  syncToolBindings,
} from './toolSetup';
import { voiRangeFromWwWl } from './wwPresets';
import { formatGrayValue, samplePixel } from '../../dicom/pixelProbe';
import { initializeDicomPipeline } from '../../dicom/init';
import type { PixelProbe } from './probeTypes';
import type { StackItem } from '../series/buildStacks';
import { InfoOverlay } from '../../ui/components/InfoOverlay';

const RENDERING_ENGINE_ID = 'dicom-viewer-m1-engine';

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
  /** 本视口在共享渲染引擎中的唯一 id（如 vp-0） */
  viewportId: string;
  /** 待显示堆栈条目（imageId + 元数据）；空数组表示空态 */
  items: StackItem[];
  defaultWwWl?: { ww: number; wl: number };
  /** 信息覆盖文字是否可见（FR-4.1） */
  showInfo: boolean;
  /** 视口就绪后上报命令式 API（仅首次） */
  onApiReady?: (api: ViewportApi) => void;
  /** UI 状态变化回调（层号 / 窗宽窗位 / 缩放） */
  onUiChange?: (ui: ViewportUiState) => void;
}

/** 取应用级单例渲染引擎（生命周期 = 应用，视口随组件挂载/卸载启用/禁用） */
function getSharedRenderingEngine(): RenderingEngine {
  return getRenderingEngine(RENDERING_ENGINE_ID) ?? new RenderingEngine(RENDERING_ENGINE_ID);
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
  viewportId,
  items,
  defaultWwWl,
  showInfo,
  onApiReady,
  onUiChange,
}: DicomViewportProps) {
  const imageIds = useMemo(() => items.map((item) => item.imageId), [items]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Types.IStackViewport | null>(null);
  const defaultWwWlRef = useRef<{ ww: number; wl: number } | undefined>(defaultWwWl);
  const probeRafRef = useRef(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pipelineReady, setPipelineReady] = useState(false);
  const [probe, setProbe] = useState<PixelProbe | null>(null);
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

  // UI 快照更新：内容不变时返回原引用（避免无谓 re-render）。
  // 注意不得在 updater 内调用 onUiChange（父组件 setState）——
  // 那会把父组件更新嵌进本组件渲染阶段，多视口下互相触发成死循环；
  // 父组件通知由下方专用 effect 在提交后完成。
  const publishUi = useCallback((partial: Partial<ViewportUiState>) => {
    setUiState((prev) => {
      const next = { ...prev, ...partial };
      return prev.sliceIndex === next.sliceIndex &&
        prev.sliceCount === next.sliceCount &&
        prev.ww === next.ww &&
        prev.wl === next.wl &&
        prev.zoom === next.zoom
        ? prev
        : next;
    });
  }, []);

  // uiState 变化后向父组件同步（提交阶段执行，安全触发父 setState）
  useEffect(() => {
    onUiChange?.(uiState);
  }, [onUiChange, uiState]);

  // 挂载期：初始化渲染/解析管线与工具（await 完成后才 enableElement）；
  // 卸载期清理。pipelineReady 变 true 后堆栈加载 effect 才允许读 viewportRef。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    let toolGroup: ReturnType<typeof createBoundToolGroup> | null = null;
    let disposed = false;

    void (async () => {
      try {
        await Promise.all([initializeDicomPipeline(), initializeTools()]);
        if (disposed) {
          return;
        }
        const renderingEngine = getSharedRenderingEngine();
        renderingEngine.enableElement({
          viewportId,
          element,
          type: Enums.ViewportType.STACK,
          defaultOptions: { background: [0, 0, 0] },
        });
        const viewport = renderingEngine.getViewport<Types.IStackViewport>(viewportId);
        viewportRef.current = viewport;
        toolGroup = createBoundToolGroup(RENDERING_ENGINE_ID, viewportId);

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
        // 管线就绪：通知堆栈加载 effect 可以安全读取 viewportRef
        if (!disposed) {
          setPipelineReady(true);
        }
      } catch (error) {
        console.error('[DicomViewport] 渲染管线初始化失败', error);
        if (!disposed) {
          setRenderError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
      viewportRef.current = null;
      if (toolGroup) {
        destroyBoundToolGroup(toolGroup);
      }
      getSharedRenderingEngine().disableElement(viewportId);
    };
    // onApiReady 由父组件以 useCallback 稳定提供，此处仅依赖 viewportId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportId]);

  // 堆栈变化时加载并渲染；应用默认 WW/WL；同步层数状态。
  // pipelineReady 未就绪时静默跳过（不报错），就绪后由依赖数组触发重新加载，
  // 从而保证 viewportRef.current 被读时 enableElement 必已完成。
  useEffect(() => {
    if (imageIds.length === 0) {
      setRenderError(null);
      setProbe(null);
      publishUi({ sliceIndex: 0, sliceCount: 0 });
      // 关闭序列后堆栈为空：releaseSeries 只清 cornerstone 缓存/注册表，
      // 已渲染的图像仍留在画布上，必须同步清空视口（FR-2.9 缺陷修复）。
      // @cornerstonejs/core@5.8.2 的 StackViewport 无 clear() API，等效清空为
      // removeAllActors（移除堆栈图像 actor，场景内不再有任何渲染体）+
      // render（下一帧仅渲染背景 [0,0,0]，画布呈纯黑）；
      // 后续 setStack 会重新 addActors，无副作用。
      // 仅当视口内确有 actor 时才清空（幂等：pipeline 就绪重跑 effect、
      // 从未加载过堆栈等场景不产生多余调用/渲染）。
      // viewport 未就绪（pipeline 初始化中/已卸载）时静默跳过，与现有容错一致。
      const viewport = viewportRef.current;
      if (viewport) {
        try {
          if (viewport.getActors().length > 0) {
            viewport.removeAllActors();
            viewport.render();
          }
        } catch {
          // 视口禁用/引擎销毁等卸载竞态：静默忽略
        }
      }
      return undefined;
    }
    if (!pipelineReady) {
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
          setRenderError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imageIds, pipelineReady, publishUi]);

  // 布局/窗口尺寸变化时按容器新尺寸重排图像：
  // Cornerstone3D 仅在 enableElement 时按元素当时尺寸设置 canvas，
  // 容器随后变化（如 1×1 → 1×2 网格切换）不会自动重算，必须显式
  // renderingEngine.resize(immediate, keepCamera)。keepCamera=true
  // 保留用户缩放/平移状态（WW/WL 为视口属性，同样不受影响）；
  // immediate=true 时库内部会调度重新渲染（ContextPool 渲染引擎确认）。
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let rafId = 0;
    // rAF 合并：网格模板切换的过渡期间连续触发的回调只执行最后一次
    const scheduleResize = () => {
      if (rafId !== 0) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        try {
          const engine = getRenderingEngine(RENDERING_ENGINE_ID);
          engine?.resize(true, true); // immediate + keepCamera
        } catch {
          // 引擎销毁等卸载竞态：静默忽略
        }
      });
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  }, []);

  // 视口事件订阅：翻页滚动 → 层号；VOI 变化 → WW/WL；相机变化 → 缩放比例；
  // 双击 → 适应窗口（FR-3.4/FR-14.1 桌面语义）
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const onScroll = (event: Event) => {
      const detail = (event as CustomEvent<Types.EventTypes.StackViewportScrollEventDetail>).detail;
      publishUi({ sliceIndex: detail.newImageIdIndex });
    };
    const onVoiModified = (event: Event) => {
      const detail = (event as CustomEvent<Types.EventTypes.VoiModifiedEventDetail>).detail;
      if (detail.viewportId !== viewportId) {
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
  }, [publishUi, viewportId]);

  // 像素探针（FR-4.5）：光标 → 图像索引 → 原始像素 → Modality LUT
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const sampleAt = (clientX: number, clientY: number) => {
      const vp = viewportRef.current;
      if (!vp) {
        return;
      }
      try {
        const rect = vp.element.getBoundingClientRect();
        const canvasX = clientX - rect.left;
        const canvasY = clientY - rect.top;
        const worldPos = vp.canvasToWorld([canvasX, canvasY]);
        if (!worldPos) {
          setProbe(null);
          return;
        }
        const imageData = vp.getImageData();
        if (!imageData) {
          setProbe(null);
          return;
        }
        const index = utilities.transformWorldToIndex(imageData, worldPos);
        const width = imageData.dimensions[0] ?? 0;
        const height = imageData.dimensions[1] ?? 0;
        const x = index[0] ?? Number.NaN;
        const y = index[1] ?? Number.NaN;
        if (
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          y < 0 ||
          x >= width ||
          y >= height
        ) {
          setProbe(null);
          return;
        }
        const currentImageId = vp.getCurrentImageId();
        const image = cache.getImage(currentImageId);
        if (!image) {
          setProbe({ imageX: x, imageY: y, valueText: null });
          return;
        }
        const components = image.color ? 3 : 1;
        const sampled = samplePixel(image.getPixelData(), image.width, x, y, components);
        setProbe({
          imageX: x,
          imageY: y,
          valueText:
            sampled !== null
              ? formatGrayValue(
                  sampled,
                  imageData.metadata.Modality ?? '',
                  image.slope,
                  image.intercept,
                )
              : null,
        });
      } catch {
        // 渲染器尚未就绪等瞬态错误：静默清除读数
        setProbe(null);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (probeRafRef.current !== 0) {
        return;
      }
      probeRafRef.current = requestAnimationFrame(() => {
        probeRafRef.current = 0;
        sampleAt(event.clientX, event.clientY);
      });
    };
    const onMouseLeave = () => {
      if (probeRafRef.current !== 0) {
        cancelAnimationFrame(probeRafRef.current);
        probeRafRef.current = 0;
      }
      setProbe(null);
    };

    element.addEventListener('mousemove', onMouseMove);
    element.addEventListener('mouseleave', onMouseLeave);
    return () => {
      element.removeEventListener('mousemove', onMouseMove);
      element.removeEventListener('mouseleave', onMouseLeave);
      if (probeRafRef.current !== 0) {
        cancelAnimationFrame(probeRafRef.current);
        probeRafRef.current = 0;
      }
    };
  }, []);

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const index = Number(event.target.value);
    publishUi({ sliceIndex: index });
    void viewportRef.current?.setImageIdIndex(index);
  };

  const canSlide = uiState.sliceCount > 1;
  const currentItem =
    items.length > 0 ? (items[Math.min(uiState.sliceIndex, items.length - 1)] ?? null) : null;

  return (
    <div className="viewport-container">
      <div className="cornerstone-element" ref={containerRef} />
      {renderError !== null && (
        <div role="alert" className="viewport-error">
          图像显示失败：{renderError}
        </div>
      )}
      {showInfo && currentItem !== null && renderError === null && (
        <InfoOverlay
          summary={currentItem.summary}
          sliceLabel={`${uiState.sliceIndex + 1} / ${uiState.sliceCount}`}
          ww={uiState.ww}
          wl={uiState.wl}
          zoomPercent={uiState.zoom * 100}
          probe={probe}
        />
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
