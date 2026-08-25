/**
 * M0 最小视口组件：Cornerstone3D StackViewport 挂载与图像显示。
 * 工具（WW/WL、缩放、平移等）在 M1 接入 @cornerstonejs/tools。
 */
import { useEffect, useRef, useState } from 'react';
import { Enums, RenderingEngine } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

const RENDERING_ENGINE_ID = 'dicom-viewer-m0-engine';
const STACK_VIEWPORT_ID = 'dicom-viewer-m0-viewport';

interface DicomViewportProps {
  /** 待显示的 imageId；null 表示空态 */
  imageId: string | null;
}

export function DicomViewport({ imageId }: DicomViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  // 创建 / 销毁渲染引擎（挂载期一次）
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const renderingEngine = new RenderingEngine(RENDERING_ENGINE_ID);
    engineRef.current = renderingEngine;
    renderingEngine.enableElement({
      viewportId: STACK_VIEWPORT_ID,
      element,
      type: Enums.ViewportType.STACK,
      defaultOptions: { background: [0, 0, 0] },
    });
    return () => {
      engineRef.current = null;
      renderingEngine.destroy();
    };
  }, []);

  // imageId 变化时加载并渲染
  useEffect(() => {
    if (imageId === null) {
      setRenderError(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const engine = engineRef.current;
        if (!engine) {
          throw new Error('渲染引擎尚未就绪');
        }
        const viewport =
          engine.getViewport<Types.IStackViewport>(STACK_VIEWPORT_ID);
        await viewport.setStack([imageId]);
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
  }, [imageId]);

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
