/**
 * M1 视口组件：Cornerstone3D StackViewport 挂载与图像堆栈显示。
 * 工具（WW/WL、缩放、平移、翻页）在 feat(tools) 提交接入 @cornerstonejs/tools。
 */
import { useEffect, useRef, useState } from 'react';
import { Enums, RenderingEngine, getRenderingEngine } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

const RENDERING_ENGINE_ID = 'dicom-viewer-m1-engine';
export const STACK_VIEWPORT_ID = 'dicom-viewer-vp-0';

interface DicomViewportProps {
  /** 待显示的 imageId 列表（堆栈）；空数组表示空态 */
  imageIds: string[];
}

/** 取应用级单例渲染引擎（生命周期 = 应用，视口随组件挂载/卸载启用/禁用） */
function getSharedRenderingEngine(): RenderingEngine {
  return (
    getRenderingEngine(RENDERING_ENGINE_ID) ??
    new RenderingEngine(RENDERING_ENGINE_ID)
  );
}

export function DicomViewport({ imageIds }: DicomViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // 挂载期启用视口；卸载期禁用（引擎为应用级单例）
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const renderingEngine = getSharedRenderingEngine();
    renderingEngine.enableElement({
      viewportId: STACK_VIEWPORT_ID,
      element,
      type: Enums.ViewportType.STACK,
      defaultOptions: { background: [0, 0, 0] },
    });
    return () => {
      renderingEngine.disableElement(STACK_VIEWPORT_ID);
    };
  }, []);

  // 堆栈变化时加载并渲染
  useEffect(() => {
    if (imageIds.length === 0) {
      setRenderError(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const engine = getRenderingEngine(RENDERING_ENGINE_ID);
        if (!engine) {
          throw new Error('渲染引擎尚未就绪');
        }
        const viewport =
          engine.getViewport<Types.IStackViewport>(STACK_VIEWPORT_ID);
        await viewport.setStack(imageIds);
        viewport.render();
        if (!cancelled) {
          setRenderError(null);
        }
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
  }, [imageIds]);

  return (
    <div className="viewport-container">
      <div className="cornerstone-element" ref={containerRef} />
      {renderError !== null && (
        <div role="alert" className="viewport-error">
          图像显示失败：{renderError}
        </div>
      )}
    </div>
  );
}
