/**
 * MPR 三平面视口组件（FR-6.1/6.2/6.3/6.4/6.8，M10-B）。
 *
 * - 轴向/冠状/矢状三个 VolumeViewport（ViewportType.ORTHOGRAPHIC）共用
 *   同一 RenderingEngine 与同一共享 volume（FR-6.8，GPU 重采样，不逐视口重建）；
 * - CrosshairsTool 联动三平面（M11-F3 方案 a）：默认 Passive（定位线渲染并
 *   随相机联动），经工具栏「定位线」按钮激活为主工具后左键拖线移动交心；
 *   定位线颜色按医学惯例红=矢状/绿=冠状/黄=轴向；
 * - 厚度模式（FR-6.4）：平均 / MIP / MinIP + 厚度 1–100mm 滑杆，作用于三视口；
 * - 基础操作继承（FR-6.6，M11-F3 矩阵）：左键平移（默认主工具）/
 *   中键窗宽窗位（常驻）/ 右键滚层 + 滚轮翻层 / Ctrl+滚轮缩放
 *   （ToolGroup 装配见 mprToolGroup.ts）；
 * - 视口容器屏蔽浏览器原生右键菜单（M11-F4：右键拖动滚层时菜单不再弹出）；
 * - 挂载期构建共享 volume（mprVolume.buildMprVolume，含逐帧 IPP provider），
 *   卸载期销毁 ToolGroup / 视口并释放 volume 与 GPU 资源（FR-7.12 同类）。
 *
 * 完成状态（M10-E）：
 *   FR-6.10 参考线随动已完成：退出 MPR 时 App 捕获轴向视口 camera.focalPoint
 *   （readMprReferenceCenter），2D Stack 视口按当前切片绘制 MPR 三平面交线
 *   （referenceLines.ts / ReferenceLinesOverlay，见 DicomViewport）。
 *   TODO(FR-6.5)：斜切 MPR（在任一平面画线/旋转角度生成沿该方向的斜切平面，
 *   任意角度重切）——采集 + 手绘线段 + oblique VolumeViewport 相机重建链路
 *   成本较高，本里程碑未实施（CrosshairsTool 旋转手柄已含于定位线交互）。
 *   TODO(M11-F2)：三平面视口尚未做容器尺寸变化的 ResizeObserver +
 *     renderingEngine.resize(immediate=true, keepCamera=true) 自适应
 *     （Cornerstone3D 仅在 enableElement 时按元素当时尺寸设 canvas，其后
 *     窗口缩放/面板变化不会自动重算，会拉伸变形）。2D DicomViewport 与
 *     Volume3dViewport 均有同类实现可参照；本次按范围只修 3D，MPR 后补。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Enums,
  RenderingEngine,
  cache,
  getRenderingEngine,
  setVolumesForViewports,
  utilities,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import { InfoOverlay } from '../../ui/components/InfoOverlay';
import { IconExit } from '../../ui/icons';
import type { SeriesStack } from '../series/buildStacks';
import {
  checkMprEligibility,
  type MprGateResult,
} from './mprGate';
import {
  MPR_PLANE_ORDER,
  MPR_VIEWPORT_IDS,
  orientationAxisKeyForPlane,
  planeLabelForViewportId,
  viewportIdForPlane,
} from './mprLayout';
import type { MprPlaneKey } from './mprLayout';
import {
  MPR_DEFAULT_THICKNESS,
  MPR_DEFAULT_THICKNESS_MODE,
  MPR_THICKNESS_MAX,
  MPR_THICKNESS_MIN,
  MPR_THICKNESS_MODES,
  clampThickness,
  thicknessParams,
  type MprThicknessMode,
} from './mprThickness';
import {
  buildMprVolume,
  createRealMprVolumeDeps,
  volumeIdForSeries,
  type MprVolumeBuildDeps,
} from './mprVolume';
import {
  createMprToolGroup,
  destroyMprToolGroup,
  initializeMprTools,
  MPR_DEFAULT_PRIMARY_TOOL,
  planeTint,
  syncMprToolBindings,
} from './mprToolGroup';
import { initializeDicomPipeline } from '../../dicom/init';

/** 与 2D 网格共享的应用级渲染引擎（生命周期 = 应用，视口随挂载/卸载启用/禁用） */
const MPR_ENGINE_ID = 'dicom-viewer-m1-engine';

interface PlaneUi {
  sliceIndex: number;
  sliceCount: number;
  ww: number;
  wl: number;
  zoom: number;
}

const EMPTY_PLANE_UI: PlaneUi = {
  sliceIndex: 0,
  sliceCount: 0,
  ww: 0,
  wl: 0,
  zoom: 1,
};

type MprStatus = 'initializing' | 'building' | 'ready' | 'error';

export interface MprViewportProps {
  /** 进入 MPR 时锁定的序列（App 按 seriesUid key 强制重挂） */
  stack: SeriesStack;
  seriesUid: string;
  showInfo: boolean;
  /** 当前左键主工具（默认平移；测量 FR-5.15 / 定位线 M11-F3），由 App 工具栏同步 */
  primaryTool?: string;
  /** 面板「跳转」请求（FR-5.9）：切到指定平面视口帧；id 递增触发 */
  jump?: { id: number; viewportId: string; sliceIndex: number } | null;
  /** 退出 MPR（返回 2D 布局，保留各视口加载状态） */
  onExitMpr: () => void;
  /** 测试注入点：volume 组装依赖（默认真实装配） */
  volumeDeps?: MprVolumeBuildDeps;
  /** 测试注入点：渲染引擎 id（默认与 2D 共享） */
  engineId?: string;
}

function getSharedRenderingEngine(engineId: string): RenderingEngine {
  return (
    getRenderingEngine(engineId) ?? new RenderingEngine(engineId)
  );
}

export function MprViewport({
  stack,
  seriesUid,
  showInfo,
  primaryTool = MPR_DEFAULT_PRIMARY_TOOL,
  jump = null,
  onExitMpr,
  volumeDeps: _volumeDeps,
  engineId = MPR_ENGINE_ID,
}: MprViewportProps) {
  const defaultDeps = useMemo(() => createRealMprVolumeDeps(), []);
  const volumeDeps = _volumeDeps ?? defaultDeps;

  const [status, setStatus] = useState<MprStatus>('initializing');
  const [buildError, setBuildError] = useState<string | null>(null);
  const [gate, setGate] = useState<MprGateResult | null>(null);
  const [thicknessMode, setThicknessMode] = useState<MprThicknessMode>(
    MPR_DEFAULT_THICKNESS_MODE,
  );
  const [slabThickness, setSlabThickness] = useState(MPR_DEFAULT_THICKNESS);
  const [activePlane, setActivePlane] = useState<MprPlaneKey>('axial');
  const [planeUiMap, setPlaneUiMap] = useState<
    Record<MprPlaneKey, PlaneUi>
  >({
    axial: EMPTY_PLANE_UI,
    coronal: EMPTY_PLANE_UI,
    sagittal: EMPTY_PLANE_UI,
  });

  const elementsRef = useRef<Partial<Record<MprPlaneKey, HTMLDivElement>>>({});
  const engineRef = useRef<RenderingEngine | null>(null);
  const volumeRef = useRef<{ volumeId: string; removeFrameIpp: () => void } | null>(null);
  const toolGroupRef = useRef<ReturnType<typeof createMprToolGroup> | null>(null);
  const disposedRef = useRef(false);

  const publishPlaneUi = useCallback((plane: MprPlaneKey, partial: Partial<PlaneUi>) => {
    setPlaneUiMap((prev) => {
      const next = { ...prev[plane], ...partial };
      const current = prev[plane];
      return current.sliceIndex === next.sliceIndex &&
        current.sliceCount === next.sliceCount &&
        current.ww === next.ww &&
        current.wl === next.wl &&
        current.zoom === next.zoom
        ? prev
        : { ...prev, [plane]: next };
    });
  }, []);

  const dispose = useCallback(() => {
    disposedRef.current = true;
    toolGroupRef.current = null;
    const vol = volumeRef.current;
    if (vol) {
      try {
        vol.removeFrameIpp();
      } catch {
        // provider 已移除等场景：忽略
      }
      try {
        cache.removeVolumeLoadObject(vol.volumeId);
      } catch {
        // volume 未入缓存等场景：忽略
      }
      volumeRef.current = null;
    }
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    try {
      destroyMprToolGroup(engineId);
    } catch {
      // ToolGroup 未创建等场景：忽略
    }
    for (const viewportId of MPR_VIEWPORT_IDS) {
      try {
        engine.disableElement(viewportId);
      } catch {
        // 视口未启用等场景：忽略
      }
    }
    engineRef.current = null;
  }, [engineId]);

  // 挂载：初始化管线 → 启用三视口 → 构建 volume → 装载 → 装配 ToolGroup
  useEffect(() => {
    const gateResult = checkMprEligibility(stack);
    setGate(gateResult);
    if (!gateResult.allowed) {
      setStatus('error');
      setBuildError(gateResult.message ?? 'MPR 不可用');
      return;
    }
    disposedRef.current = false;
    void (async () => {
      try {
        await Promise.all([initializeDicomPipeline(), initializeMprTools()]);
        if (disposedRef.current) {
          return;
        }
        const engine = getSharedRenderingEngine(engineId);
        engineRef.current = engine;

        for (const plane of MPR_PLANE_ORDER) {
          const element = elementsRef.current[plane];
          if (!element) {
            throw new Error(`MPR 平面容器缺失: ${plane}`);
          }
          engine.enableElement({
            viewportId: viewportIdForPlane(plane),
            element,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            defaultOptions: {
              orientation: Enums.OrientationAxis[orientationAxisKeyForPlane(plane)],
              background: [0, 0, 0],
            },
          });
        }

        setStatus('building');
        const volumeId = volumeIdForSeries(seriesUid || stack.seriesUid);
        const built = await buildMprVolume(volumeId, stack, volumeDeps);
        if (disposedRef.current) {
          built.removeFrameIpp();
          try {
            cache.removeVolumeLoadObject(volumeId);
          } catch {
            // 忽略竞态
          }
          return;
        }
        volumeRef.current = {
          volumeId: built.volumeId,
          removeFrameIpp: built.removeFrameIpp,
        };

        await setVolumesForViewports(
          engine,
          [{ volumeId: built.volumeId }],
          [...MPR_VIEWPORT_IDS],
        );
        if (disposedRef.current) {
          return;
        }

        toolGroupRef.current = createMprToolGroup(engineId);
        setStatus('ready');
      } catch (error) {
        console.error('[MprViewport] 初始化失败', error);
        if (!disposedRef.current) {
          setStatus('error');
          setBuildError(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      dispose();
    };
    // 挂载期一次性执行；volumeDeps 以稳定引用提供
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineId, stack, seriesUid, volumeDeps]);

  // 主工具联动（M10-D FR-5.15）：工具栏/快捷键切换测量工具时同步 MPR 三视口 ToolGroup
  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const group = toolGroupRef.current;
    if (group) {
      syncMprToolBindings(group, primaryTool);
    }
  }, [status, primaryTool]);

  // 面板「跳转」→ 滚动对应平面到目标帧（FR-5.9/5.15）
  useEffect(() => {
    if (status !== 'ready' || jump === null) {
      return;
    }
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    const viewport = engine.getViewport<Types.IVolumeViewport>(jump.viewportId);
    if (!viewport) {
      return;
    }
    try {
      const current = typeof viewport.getSliceIndex === 'function' ? viewport.getSliceIndex() : undefined;
      if (typeof current === 'number' && current !== jump.sliceIndex) {
        utilities.scroll(
          viewport as unknown as Parameters<typeof utilities.scroll>[0],
          { delta: jump.sliceIndex - current },
        );
      }
    } catch {
      // 视口/引擎未就绪等瞬态：忽略
    }
  }, [status, jump]);

  // 视口事件订阅：翻层 / VOI / 相机 → 驱动每平面 UI 状态
  useEffect(() => {
    if (status !== 'ready') {
      return undefined;
    }
    const engine = engineRef.current;
    if (!engine) {
      return undefined;
    }
    const listeners: Array<{
      element: HTMLDivElement;
      type: string;
      handler: EventListener;
    }> = [];
    for (const plane of MPR_PLANE_ORDER) {
      const element = elementsRef.current[plane];
      const viewportId = viewportIdForPlane(plane);
      if (!element) {
        continue;
      }
      const onNewVolumeImage = (event: Event) => {
        const detail = (event as CustomEvent<{ imageIndex: number; numberOfSlices: number }>)
          .detail;
        publishPlaneUi(plane, {
          sliceIndex: detail.imageIndex ?? 0,
          sliceCount: detail.numberOfSlices ?? 0,
        });
      };
      const onVoiModified = (event: Event) => {
        const detail = (event as CustomEvent<{ viewportId: string; range: Types.VOIRange }>)
          .detail;
        if (detail.viewportId !== viewportId) {
          return;
        }
        const range = detail.range;
        if (!range) {
          return;
        }
        publishPlaneUi(plane, {
          ww: Math.round((range.upper - range.lower) * 100) / 100,
          wl: Math.round(((range.upper + range.lower) / 2) * 100) / 100,
        });
      };
      const onCameraModified = () => {
        const vp = engine.getViewport<Types.IVolumeViewport>(viewportId);
        if (!vp) {
          return;
        }
        const zoom = typeof vp.getZoom === 'function' ? vp.getZoom() : 1;
        publishPlaneUi(plane, { zoom: Math.round(zoom * 100) / 100 });
      };
      for (const [type, handler] of [
        [Enums.Events.VOLUME_NEW_IMAGE, onNewVolumeImage],
        [Enums.Events.VOI_MODIFIED, onVoiModified],
        [Enums.Events.CAMERA_MODIFIED, onCameraModified],
      ] as const) {
        element.addEventListener(type, handler);
        listeners.push({ element, type, handler });
      }
    }
    return () => {
      for (const { element, type, handler } of listeners) {
        element.removeEventListener(type, handler);
      }
    };
  }, [status, publishPlaneUi]);

  // 厚度模式 / 厚度变化 → 应用到三视口（FR-6.4）
  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    const { blendModeKey, slabThickness: slab } = thicknessParams(
      thicknessMode,
      slabThickness,
    );
    const blendMode = Enums.BlendModes[blendModeKey];
    for (const viewportId of MPR_VIEWPORT_IDS) {
      const vp = engine.getViewport<Types.IVolumeViewport>(viewportId);
      if (!vp) {
        continue;
      }
      vp.setBlendMode(blendMode);
      vp.setSlabThickness(slab);
      vp.render?.();
    }
  }, [status, thicknessMode, slabThickness]);

  // 覆盖信息用摘要：去掉 IOP，避免在非轴向平面显示误导性的方向标记
  const overlaySummary = useMemo(() => {
    const summary = stack.items[0]?.summary;
    if (!summary) {
      return undefined;
    }
    return { ...summary, imageOrientationPatient: undefined };
  }, [stack]);

  const activePlaneUi = planeUiMap[activePlane] ?? EMPTY_PLANE_UI;
  const activeSliceCount = activePlaneUi.sliceCount || stack.items.length;

  const handleThicknessInput = (value: number) => {
    setSlabThickness(clampThickness(value));
  };

  return (
    <div className="mpr-root">
      <div className="mpr-bar">
        <span className="mpr-title">MPR 三平面</span>
        <span className="mpr-slice-indicator">
          {viewplaneLabel(activePlane)} · 第 {activePlaneUi.sliceIndex + 1} /{' '}
          {activeSliceCount} 层
        </span>
        <label className="mpr-field">
          重建模式
          <select
            value={thicknessMode}
            onChange={(event) => setThicknessMode(event.target.value as MprThicknessMode)}
            aria-label="MPR 重建模式"
          >
            {MPR_THICKNESS_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mpr-field mpr-thickness-field">
          厚度
          <input
            type="range"
            className="mpr-thickness-slider"
            min={MPR_THICKNESS_MIN}
            max={MPR_THICKNESS_MAX}
            step={1}
            value={clampThickness(slabThickness)}
            onChange={(event) => handleThicknessInput(Number(event.target.value))}
            aria-label="MPR 重建厚度 (mm)"
          />
          <input
            type="number"
            className="mpr-thickness-input"
            min={MPR_THICKNESS_MIN}
            max={MPR_THICKNESS_MAX}
            step={1}
            value={clampThickness(slabThickness)}
            onChange={(event) => handleThicknessInput(Number(event.target.value))}
            onBlur={(event) => handleThicknessInput(Number(event.target.value))}
            aria-label="MPR 重建厚度数值 (mm)"
          />
          <span>mm</span>
        </label>
        {gate?.nonUniformSpacing === true && (
          <span className="mpr-note">层间距不一致，已按图像位置（IPP）重采样</span>
        )}
        <button
          type="button"
          className="tool-button"
          aria-label="退出 MPR，返回 2D 布局"
          onClick={onExitMpr}
        >
          <IconExit />
          <span className="tool-button-label">退出 MPR</span>
        </button>
      </div>

      <div className="viewer-grid-wrap mpr-grid-wrap">
        <div
          className="viewer-grid"
          style={{
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gridTemplateRows: 'minmax(0, 1fr)',
          }}
        >
          {MPR_PLANE_ORDER.map((plane) => {
            const ui = planeUiMap[plane] ?? EMPTY_PLANE_UI;
            const isActive = plane === activePlane;
            return (
              <div
                key={plane}
                className={`viewport-cell${isActive ? ' viewport-cell--active' : ''}`}
                onMouseDown={() => setActivePlane(plane)}
              >
                <div
                  className="cornerstone-element"
                  ref={(element) => {
                    elementsRef.current[plane] = element ?? undefined;
                  }}
                  // M11-F4：屏蔽浏览器原生右键菜单（右键拖动滚层时干扰操作），
                  // 仅 preventDefault，不拦截 mousedown/mousemove 事件流。
                  onContextMenu={(event) => event.preventDefault()}
                />
                <div
                  className="mpr-plane-tint"
                  style={{ boxShadow: `inset 0 0 0 2px ${planeTint(plane)}` }}
                />
                <div className="viewport-badge">
                  {viewplaneLabel(plane)} · {ui.sliceIndex + 1} /{' '}
                  {ui.sliceCount || stack.items.length} 层
                </div>
                {isActive && showInfo && overlaySummary !== undefined && (
                  <InfoOverlay
                    summary={overlaySummary}
                    sliceLabel={`${ui.sliceIndex + 1} / ${
                      ui.sliceCount || stack.items.length
                    }`}
                    ww={ui.ww}
                    wl={ui.wl}
                    zoomPercent={ui.zoom * 100}
                    probe={null}
                  />
                )}
              </div>
            );
          })}
        </div>

        {(status === 'initializing' || status === 'building') && (
          <div className="empty-hint" aria-live="polite">
            {status === 'initializing'
              ? '正在初始化 MPR 渲染管线…'
              : `正在构建体数据…（${stack.items.length} 层）`}
          </div>
        )}
        {status === 'error' && (
          <div role="alert" className="viewport-error">
            MPR 不可用:{buildError}
            <button
              type="button"
              className="tool-button"
              aria-label="返回 2D 阅片"
              onClick={onExitMpr}
            >
              <IconExit />
              <span className="tool-button-label">返回 2D 阅片</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function viewplaneLabel(plane: MprPlaneKey): string {
  return planeLabelForViewportId(viewportIdForPlane(plane));
}

export default MprViewport;