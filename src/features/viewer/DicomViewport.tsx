/**
 * M1 视口组件：Cornerstone3D StackViewport + @cornerstonejs/tools 工具绑定
 * + 信息覆盖文字与像素探针。
 *
 * - 挂载期创建共享渲染引擎上的视口与专属 ToolGroup（M11-F3 矩阵：左键平移/
 *   中键调窗/右键翻层/滚轮翻页/Ctrl+滚轮缩放，见 toolSetup.ts）；
 * - 堆栈变化时 setStack、应用默认窗宽窗位并同步层数状态；
 * - 订阅 STACK_VIEWPORT_SCROLL / VOI_MODIFIED / CAMERA_MODIFIED 事件，
 *   驱动层滑块、WW/WL 输入框与缩放比例显示；
 * - 光标移动时采样像素值（经 Modality LUT 显示 HU，FR-4.5）；
 * - 视口容器屏蔽浏览器原生右键菜单（M11-F4：右键拖动翻层时菜单不再弹出，
 *   仅 preventDefault，不拦截 mousedown/mousemove 事件流）；
 * - 通过 onApiReady 上报命令式操作接口，供工具栏与全局快捷键调用。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Enums, RenderingEngine, cache, getRenderingEngine, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import {
  createBoundToolGroup,
  destroyBoundToolGroup,
  initializeTools,
  syncToolBindings,
} from './toolSetup';
import { addRotation } from './viewTransform';
import { computeReferenceLineSegments } from '../mpr/referenceLines';
import type { LineSegment, MprPlaneKey, Point2, Point3 } from '../mpr/referenceLines';
import { ReferenceLinesOverlay } from '../mpr/ReferenceLinesOverlay';
import { CROSS_REFERENCE_LINE_COLOR } from './crossReferenceLines';
import type { CrossReferenceLine, SlicePlaneGeometry } from './crossReferenceLines';
import { TOUCH_TAP_EVENT } from './touchEvents';
import { voiRangeFromWwWl } from './wwPresets';
import { formatGrayValue, samplePixel } from '../../dicom/pixelProbe';
import { initializeDicomPipeline } from '../../dicom/init';
import type { PixelProbe } from './probeTypes';
import type { StackItem } from '../series/buildStacks';
import { InfoOverlay } from '../../ui/components/InfoOverlay';

const RENDERING_ENGINE_ID = 'dicom-viewer-m1-engine';

/**
 * Cornerstone「图像数据已切换」事件名（FR-3.15）。
 * 运行时由 cornerstone 提供；部分测试 mock 未声明该事件，缺失时跳过订阅，
 * 仍由 stackEpoch 等既有信号兜底。
 */
const STACK_NEW_IMAGE_EVENT = Enums.Events?.STACK_NEW_IMAGE;

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
  /** 反色显示（FR-3.9）：各视口独立 */
  invert: boolean;
  /** 视图旋转角度（°）：正值 = 逆时针（FR-3.10） */
  rotation: number;
  /**
   * 堆栈加载纪元（FR-3.15）：每次 setStack 成功递增。
   * 供 App 在「替换序列但层号/层数不变」时也重新计算跨视口定位线。
   */
  stackEpoch: number;
  /**
   * 已渲染图像纪元（FR-3.15）：STACK_NEW_IMAGE（新图像数据已就绪）后递增。
   * 滑块/滚轮/ Cine 会先更新目标层号，异步解码完成前 getSliceGeometry 仍
   * 返回上一张图像的几何；App 以本字段作为「几何已到位」的重算触发键，
   * 避免用旧几何计算定位线，也避免逐帧/轮询重算。
   */
  renderedImageEpoch: number;
}

/** 切回 2D 后显示的 MPR 十字交点（FR-6.10） */
export interface MprReferenceCenter {
  /** 所属序列 UID（仅当视口显示该序列时绘制参考线） */
  seriesUid: string;
  /** MPR 十字交点世界坐标（轴向视口 camera.focalPoint） */
  world: [number, number, number];
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
  /** 切换反色显示（FR-3.9）：各视口独立 */
  toggleInvert: () => void;
  /** 旋转当前视口图像：delta 为增量角（°），正 = 逆时针（FR-3.10） */
  rotateStep: (deltaDegrees: number) => void;
  /** 全局视图重置：WW/WL + 缩放 + 平移 + 反色 + 旋转（FR-3.11，Shift+R） */
  resetView: () => void;
  /**
   * 读取自身当前切片几何（世界坐标 IPP + 行列方向 + spacing + 行列数），
   * 供 App 计算跨视口切面定位线（FR-3.15）。
   */
  getSliceGeometry: () => SlicePlaneGeometry | null;
  /**
   * 接收 App 下发的跨视口切面定位线（目标视口像素坐标）；null 表示清除。
   * 仅做展示，不改变相机/工具/序列状态（FR-3.15）。
   */
  setCrossReferenceLine: (line: CrossReferenceLine | null) => void;
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
  /** UI 状态变化回调（层号 / 窗宽窗位 / 缩放 / 反色 / 旋转） */
  onUiChange?: (ui: ViewportUiState) => void;
  /** MPR 参考线中心（FR-6.10）：非空且与当前序列匹配时绘制参考线 */
  referenceCenter?: MprReferenceCenter | null;
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

/** 读取视口旋转值：优先 cornerstone 公开 API getRotation，失败回退镜像值 */
function readViewportRotation(viewport: object, fallback: number): number {
  try {
    const getter = (viewport as { getRotation?: () => number }).getRotation;
    if (typeof getter === 'function') {
      const value = getter.call(viewport);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  } catch {
    // 视口禁用等瞬态：忽略
  }
  return fallback;
}

/** 写入视口旋转：setRotation 在 d.ts 声明为 protected，运行时为实例可调用方法 */
function writeViewportRotation(viewport: object, degrees: number): boolean {
  try {
    const setter = (viewport as { setRotation?: (deg: number) => void }).setRotation;
    if (typeof setter === 'function') {
      setter.call(viewport, degrees);
      return true;
    }
  } catch {
    // 视口禁用等瞬态：忽略
  }
  return false;
}

/** 切片像素坐标 → 世界坐标（与 vtk imageData direction/spacing 布局对齐） */
function pixelToWorld(
  origin: Point3,
  spacing: [number, number],
  rowDir: Point3,
  colDir: Point3,
  p: Point2,
): Point3 {
  return [
    origin[0] + p.x * spacing[0] * rowDir[0] + p.y * spacing[1] * colDir[0],
    origin[1] + p.x * spacing[0] * rowDir[1] + p.y * spacing[1] * colDir[1],
    origin[2] + p.x * spacing[0] * rowDir[2] + p.y * spacing[1] * colDir[2],
  ];
}

export function DicomViewport({
  viewportId,
  items,
  defaultWwWl,
  showInfo,
  onApiReady,
  onUiChange,
  referenceCenter = null,
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
    invert: false,
    rotation: 0,
    stackEpoch: 0,
    renderedImageEpoch: 0,
  });
  // 堆栈加载纪元（每次 setStack 成功递增；供跨视口定位线重算）
  const stackEpochRef = useRef(0);
  // 已渲染图像纪元（每次 STACK_NEW_IMAGE 递增；表示当前几何已真正切换）
  const renderedImageEpochRef = useRef(0);
  // 旋转值镜像（rotateStep/resetView 内读取当前值；cornerstone getRotation 兜底）
  const rotationRef = useRef(0);

  // ── 跨视口切面定位线（FR-3.15）──────────────────────
  // 线段由 App 按「激活视口 → 非激活视口」计算后下发；本组件只负责
  // 像素坐标 → 世界坐标 → 画布坐标的实时投影，不参与几何计算。
  const [crossReferenceLine, setCrossReferenceLineState] = useState<CrossReferenceLine | null>(
    null,
  );
  const crossReferenceLineRef = useRef<CrossReferenceLine | null>(null);
  // items 镜像：命令式 getSliceGeometry 在挂载期创建，不能闭包捕获首帧 props
  const itemsRef = useRef(items);
  // 相机变化后仅重投影（rAF 合并），不重算几何，避免逐帧几何开销
  const projectionRafRef = useRef(0);
  const [, forceProjection] = useReducer((version: number) => version + 1, 0);

  // 默认窗宽窗位变化时保持 ref 同步（供 API 回调读取最新值）
  useEffect(() => {
    defaultWwWlRef.current = defaultWwWl;
  }, [defaultWwWl]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    crossReferenceLineRef.current = crossReferenceLine;
  }, [crossReferenceLine]);

  // 卸载时取消尚未执行的投影重绘（避免对已卸载视口 setState）
  useEffect(
    () => () => {
      if (projectionRafRef.current !== 0) {
        cancelAnimationFrame(projectionRafRef.current);
        projectionRafRef.current = 0;
      }
    },
    [],
  );

  /**
   * 读取当前切片几何：imageData 提供 origin/direction/spacing/dimensions，
   * 当前 StackItem 提供 FrameOfReferenceUID（imageData.metadata 兜底）。
   * 视口未就绪/字段非法时返回 null（App 据此不画线，不抛错）。
   */
  const readSliceGeometry = useCallback((): SlicePlaneGeometry | null => {
    const vp = viewportRef.current;
    if (!vp) {
      return null;
    }
    try {
      const imageData = (vp as { getImageData?: () => unknown }).getImageData?.();
      if (imageData === null || imageData === undefined || typeof imageData !== 'object') {
        return null;
      }
      const data = imageData as {
        origin?: unknown;
        spacing?: unknown;
        dimensions?: unknown;
        direction?: unknown;
        metadata?: Record<string, unknown>;
      };
      const origin = Array.isArray(data.origin) ? data.origin : null;
      const spacing = Array.isArray(data.spacing) ? data.spacing : null;
      const dimensions = Array.isArray(data.dimensions) ? data.dimensions : null;
      const direction = Array.isArray(data.direction) ? data.direction : null;
      if (
        origin === null ||
        spacing === null ||
        dimensions === null ||
        direction === null ||
        origin.length < 3 ||
        spacing.length < 2 ||
        dimensions.length < 2 ||
        direction.length < 6
      ) {
        return null;
      }
      const origin3: Point3 = [origin[0] as number, origin[1] as number, origin[2] as number];
      const rowDir: Point3 = [
        direction[0] as number,
        direction[1] as number,
        direction[2] as number,
      ];
      const colDir: Point3 = [
        direction[3] as number,
        direction[4] as number,
        direction[5] as number,
      ];
      const spacingX = spacing[0] as number;
      const spacingY = spacing[1] as number;
      const columns = dimensions[0] as number;
      const rows = dimensions[1] as number;
      if (
        !origin3.every((value) => Number.isFinite(value)) ||
        !rowDir.every((value) => Number.isFinite(value)) ||
        !colDir.every((value) => Number.isFinite(value)) ||
        !Number.isFinite(spacingX) ||
        !Number.isFinite(spacingY) ||
        spacingX <= 0 ||
        spacingY <= 0 ||
        !Number.isFinite(columns) ||
        !Number.isFinite(rows) ||
        columns <= 0 ||
        rows <= 0
      ) {
        return null;
      }

      let sliceIndex = 0;
      try {
        sliceIndex = vp.getCurrentImageIdIndex();
      } catch {
        // 视口禁用等瞬态：使用首帧兜底
      }
      const list = itemsRef.current;
      const safeIndex = Math.max(0, Math.min(sliceIndex, list.length - 1));
      const currentItem = list.length > 0 ? list[safeIndex] : undefined;
      // 序列替换的瞬态：items 已更新但 setStack 尚未完成，imageData 仍属旧序列，
      // 此时返回 null，避免用旧几何算线；setStack 完成后 stackEpoch 递增会重算。
      try {
        const liveImageId = (vp as { getCurrentImageId?: () => string }).getCurrentImageId?.();
        if (
          typeof liveImageId === 'string' &&
          liveImageId !== '' &&
          currentItem !== undefined &&
          liveImageId !== currentItem.imageId
        ) {
          return null;
        }
      } catch {
        // 视口禁用等瞬态：继续使用 imageData
      }
      const metadataUid = data.metadata?.FrameOfReferenceUID;
      const frameOfReferenceUID =
        currentItem?.summary.frameOfReferenceUid ??
        (typeof metadataUid === 'string' && metadataUid !== '' ? metadataUid : undefined);

      return {
        frameOfReferenceUID,
        origin: origin3,
        rowDir,
        colDir,
        spacing: [spacingX, spacingY],
        columns,
        rows,
      };
    } catch {
      // 视口禁用/卸载竞态：静默返回空
      return null;
    }
  }, []);

  /** 外部线段去重：数值完全一致时复用原对象，避免无谓 re-render */
  const applyCrossReferenceLine = useCallback((line: CrossReferenceLine | null) => {
    setCrossReferenceLineState((prev) => {
      if (prev === null || line === null) {
        return prev === line ? prev : line;
      }
      const a = prev.segment;
      const b = line.segment;
      const g = prev.geometry;
      const h = line.geometry;
      const same =
        a.p1.x === b.p1.x &&
        a.p1.y === b.p1.y &&
        a.p2.x === b.p2.x &&
        a.p2.y === b.p2.y &&
        g.frameOfReferenceUID === h.frameOfReferenceUID &&
        g.origin[0] === h.origin[0] &&
        g.origin[1] === h.origin[1] &&
        g.origin[2] === h.origin[2] &&
        g.rowDir[0] === h.rowDir[0] &&
        g.rowDir[1] === h.rowDir[1] &&
        g.rowDir[2] === h.rowDir[2] &&
        g.colDir[0] === h.colDir[0] &&
        g.colDir[1] === h.colDir[1] &&
        g.colDir[2] === h.colDir[2] &&
        g.spacing[0] === h.spacing[0] &&
        g.spacing[1] === h.spacing[1] &&
        g.columns === h.columns &&
        g.rows === h.rows;
      return same ? prev : line;
    });
  }, []);

  /** 相机变化后按帧合并重投影（仅存在定位线时才触发） */
  const scheduleCrossReferenceProjection = useCallback(() => {
    if (crossReferenceLineRef.current === null || projectionRafRef.current !== 0) {
      return;
    }
    projectionRafRef.current = requestAnimationFrame(() => {
      projectionRafRef.current = 0;
      forceProjection();
    });
  }, []);

  // MPR 参考线（FR-6.10）：每次切片变化重算像素坐标线段；
  // 画布坐标随相机在渲染时实时投影（worldToCanvas），平移/缩放/旋转自动保持。
  const [referenceSegments, setReferenceSegments] = useState<
    Array<{ plane: MprPlaneKey; segment: LineSegment }> | null
  >(null);
  const referenceTransformRef = useRef<{
    origin: Point3;
    rowDir: Point3;
    colDir: Point3;
    spacing: [number, number];
  } | null>(null);

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
        prev.zoom === next.zoom &&
        prev.invert === next.invert &&
        prev.rotation === next.rotation &&
        prev.stackEpoch === next.stackEpoch &&
        prev.renderedImageEpoch === next.renderedImageEpoch
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
          toggleInvert: () => {
            const vp = viewportRef.current;
            if (!vp) {
              return;
            }
            try {
              const next = !(vp.getProperties().invert === true);
              vp.setProperties({ invert: next });
              vp.render();
              publishUi({ invert: next });
            } catch {
              // 视口禁用等瞬态：忽略
            }
          },
          rotateStep: (deltaDegrees) => {
            const vp = viewportRef.current;
            if (!vp || !Number.isFinite(deltaDegrees)) {
              return;
            }
            try {
              const current = readViewportRotation(vp, rotationRef.current);
              const next = addRotation(current, deltaDegrees);
              rotationRef.current = next;
              if (writeViewportRotation(vp, next)) {
                vp.render();
              }
              publishUi({ rotation: next });
            } catch {
              // 视口禁用等瞬态：忽略
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
          getSliceGeometry: readSliceGeometry,
          setCrossReferenceLine: applyCrossReferenceLine,
          resetView: () => {
            const vp = viewportRef.current;
            if (!vp) {
              return;
            }
            const fallback = defaultWwWlRef.current;
            if (fallback) {
              vp.setProperties({ voiRange: voiRangeFromWwWl(fallback.ww, fallback.wl) });
            }
            // 反色/旋转一并复位（FR-3.11 全局重置语义）
            vp.setProperties({ invert: false });
            rotationRef.current = 0;
            writeViewportRotation(vp, 0);
            vp.resetCamera({ resetPan: true, resetZoom: true });
            vp.render();
            publishUi({ invert: false, rotation: 0 });
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
        stackEpochRef.current += 1;
        publishUi({
          sliceCount: imageIds.length,
          sliceIndex: viewport.getCurrentImageIdIndex(),
          zoom: 1,
          stackEpoch: stackEpochRef.current,
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

  // MPR 参考线（FR-6.10）：参考中心非空且切片就绪时，计算 MPR 三平面与
  // 当前切片的交线（切片像素坐标）；画布坐标在渲染时用 worldToCanvas 实时投影，
  // 平移/缩放/旋转相机不须重算线段本身。
  useEffect(() => {
    if (!referenceCenter || !pipelineReady || imageIds.length === 0) {
      referenceTransformRef.current = null;
      setReferenceSegments(null);
      return;
    }
    const vp = viewportRef.current;
    if (!vp) {
      return;
    }
    const imageData = (vp as { getImageData?: () => unknown }).getImageData?.();
    if (!imageData) {
      return;
    }
    const data = imageData as {
      origin?: number[];
      spacing?: number[];
      dimensions?: number[];
      direction?: number[];
    };
    const origin = data.origin;
    const spacing = data.spacing;
    const dimensions = data.dimensions;
    const direction = data.direction;
    if (!origin || !spacing || !dimensions || !direction || origin.length < 3) {
      setReferenceSegments(null);
      return;
    }
    const rowDir: Point3 = [direction[0] ?? 0, direction[1] ?? 0, direction[2] ?? 0];
    const colDir: Point3 = [direction[3] ?? 0, direction[4] ?? 0, direction[5] ?? 0];
    referenceTransformRef.current = {
      origin: [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0],
      rowDir,
      colDir,
      spacing: [spacing[0] ?? 1, spacing[1] ?? 1],
    };
    const segments = computeReferenceLineSegments(
      {
        origin: [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0],
        rowDir,
        colDir,
        center: referenceCenter.world,
        width: dimensions[0] ?? 0,
        height: dimensions[1] ?? 0,
      },
      spacing[0] ?? 1,
      spacing[1] ?? 1,
    );
    setReferenceSegments(segments.length > 0 ? segments : null);
  }, [referenceCenter, pipelineReady, imageIds, uiState.sliceIndex]);

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
          // 尺寸变化后画布投影矩阵改变，定位线需按新画布重投影（FR-3.15）
          scheduleCrossReferenceProjection();
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
  }, [scheduleCrossReferenceProjection]);

  // 视口事件订阅：翻页滚动 → 层号；VOI 变化 → WW/WL；相机变化 → 缩放比例；
  // 双击（桌面 dblclick / 触控 TOUCH_TAP taps=2）→ 适应窗口（FR-3.4/FR-14.1）
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }
    const onScroll = (event: Event) => {
      const detail = (event as CustomEvent<Types.EventTypes.StackViewportScrollEventDetail>).detail;
      publishUi({ sliceIndex: detail.newImageIdIndex });
    };
    // 图像数据真正切换后才递增纪元：滑块/滚轮可能先更新层号，解码完成前
    // 几何仍属上一张图像；App 依赖该纪元在切换后补一次几何重算（FR-3.15）。
    const onStackNewImage = (event: Event) => {
      const detail = (event as CustomEvent<{ imageIdIndex?: number }>).detail;
      renderedImageEpochRef.current += 1;
      publishUi({
        renderedImageEpoch: renderedImageEpochRef.current,
        ...(typeof detail?.imageIdIndex === 'number'
          ? { sliceIndex: detail.imageIdIndex }
          : {}),
      });
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
        scheduleCrossReferenceProjection();
      }
    };
    // 触控双击（FR-14.1）：Cornerstone 将快速两次轻点合成 TOUCH_TAP（taps=2），
    // 与桌面 dblclick 同为「适应窗口」语义；单指/双指拖动由工具层处理。
    const onTouchTap = (event: Event) => {
      const detail = (event as CustomEvent<{ taps?: number }>).detail;
      if (detail?.taps !== 2) {
        return;
      }
      onDoubleClick();
    };
    const onCameraModified = () => {
      syncZoom();
      // 平移/缩放/旋转/翻层后线段必须跟随图像（只重投影，不重算几何）
      scheduleCrossReferenceProjection();
    };
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onScroll);
    element.addEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, onCameraModified);
    element.addEventListener('dblclick', onDoubleClick);
    if (STACK_NEW_IMAGE_EVENT) {
      element.addEventListener(STACK_NEW_IMAGE_EVENT, onStackNewImage);
    }
    if (TOUCH_TAP_EVENT) {
      element.addEventListener(TOUCH_TAP_EVENT, onTouchTap);
    }
    return () => {
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onScroll);
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCameraModified);
      element.removeEventListener('dblclick', onDoubleClick);
      if (STACK_NEW_IMAGE_EVENT) {
        element.removeEventListener(STACK_NEW_IMAGE_EVENT, onStackNewImage);
      }
      if (TOUCH_TAP_EVENT) {
        element.removeEventListener(TOUCH_TAP_EVENT, onTouchTap);
      }
    };
  }, [publishUi, scheduleCrossReferenceProjection, viewportId]);

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
      {/* M11-F4：屏蔽浏览器原生右键菜单（右键拖动翻层时干扰操作）。
          仅 preventDefault 阻止默认菜单，不 stopPropagation/不拦截
          mousedown/mousemove 事件流，cornerstone 右键交互不受影响；
          视口外（面板/工具栏）右键粘贴等浏览器能力不受影响。 */}
      <div
        className="cornerstone-element"
        ref={containerRef}
        onContextMenu={(event) => event.preventDefault()}
      />
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
          rotationDegrees={uiState.rotation}
        />
      )}
      {referenceSegments !== null &&
        referenceCenter !== null &&
        renderError === null &&
        (() => {
          const transform = referenceTransformRef.current;
          if (!transform) {
            return null;
          }
          const toWorld = (p: Point2) =>
            pixelToWorld(
              transform.origin,
              transform.spacing,
              transform.rowDir,
              transform.colDir,
              p,
            );
          const project = (world: Point3): { x: number; y: number } | undefined => {
            try {
              const canvas = viewportRef.current?.worldToCanvas(world);
              if (!canvas) {
                return undefined;
              }
              return { x: canvas[0], y: canvas[1] };
            } catch {
              return undefined;
            }
          };
          const overlaySegments = referenceSegments.map(({ plane, segment }) => ({
            plane,
            p1: segment.p1,
            p2: segment.p2,
          }));
          return (
            <ReferenceLinesOverlay
              segments={overlaySegments}
              toWorld={toWorld}
              project={project}
            />
          );
        })()}
      {/* FR-3.15 跨视口切面定位线：App 已按目标视口像素坐标裁切为单条线段；
          这里复用 ReferenceLinesOverlay 做像素→世界→画布投影。plane 固定
          'axial' 仅为取现有调色板中的黄色（#ffff00），不按平面语义取色。 */}
      {crossReferenceLine !== null &&
        renderError === null &&
        (() => {
          const { geometry, segment } = crossReferenceLine;
          const toWorld = (p: Point2) =>
            pixelToWorld(geometry.origin, geometry.spacing, geometry.rowDir, geometry.colDir, p);
          const project = (world: Point3): { x: number; y: number } | undefined => {
            try {
              const canvas = viewportRef.current?.worldToCanvas(world);
              if (!canvas) {
                return undefined;
              }
              return { x: canvas[0], y: canvas[1] };
            } catch {
              return undefined;
            }
          };
          return (
            <div
              className="cross-reference-lines"
              data-testid="cross-reference-lines"
              data-line-color={CROSS_REFERENCE_LINE_COLOR}
            >
              <ReferenceLinesOverlay
                segments={[{ plane: 'axial', p1: segment.p1, p2: segment.p2 }]}
                toWorld={toWorld}
                project={project}
              />
            </div>
          );
        })()}
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
