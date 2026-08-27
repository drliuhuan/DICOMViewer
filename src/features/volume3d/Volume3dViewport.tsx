/**
 * 3D 体绘制视口组件（FR-7.1/7.2/7.3/7.4/7.6/7.7/7.8/7.9/7.12，M10-C）。
 *
 * - 渲染：VOLUME_3D 视口（vtk.js 光线投射），复用 M10-B 的 volume 构建路径
 *   （buildMprVolume，同一序列并行为三维体数据）；旋转/平移/缩放/调窗由
 *   Pan/WindowLevel/TrackballRotate/Zoom ToolGroup 提供（M11-F3 矩阵：
 *   左键平移、中键调窗、右键旋转、滚轮缩放）；
 * - 预设（FR-7.2）：CT-Bone/Angio/Soft-Tissue/Skin/MIP 下拉切换，赋色/
 *   不透明度传递函数到 volume actor 属性；
 * - 窗宽窗位（FR-7.3）：调整实时影响体绘制映射范围；「联动 2D」开关把
 *   变更与 2D 激活视口双向同步；
 * - 质量档位（FR-7.7）+ 渐进式渲染（FR-7.6，交互低质量、静止提升）；
 * - 裁剪平面（FR-7.4）：轴/冠/矢三向滑杆，映射到 volume mapper 硬件裁剪；
 * - 视口容器屏蔽浏览器原生右键菜单（M11-F4：右键拖动旋转时菜单不再弹出）；
 * - 复位视角（FR-7.9）：一键恢复轴位俯视默认视角；
 * - 3D 截图（FR-7.8）：当前视角 canvas 导出 PNG；
 * - 内存释放（FR-7.12）：卸载时销毁 ToolGroup/禁用视口并删除 volume 缓存
 *   与逐帧 IPP provider（与 MPR 同类）。
 *
 * 待办（P1 未做或降级，不阻塞核心）：
 *   TODO(FR-7.4)：裁剪平面仅提供轴/冠/矢固定方向滑杆，无可拖动平面手柄、
 *     无六面裁剪盒（六面为 P2 FR-7.5）。
 *   TODO(FR-7.1)：鼠标绑定「可在设置里调整」为 P2（快捷键可配置 FR-11 P2），
 *     当前按 FR-7.1 默认绑定实现，设置面板未暴露绑定项。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Enums,
  RenderingEngine,
  cache,
  getRenderingEngine,
  setVolumesForViewports,
} from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import { InfoOverlay } from '../../ui/components/InfoOverlay';
import {
  IconCamera,
  IconExit,
  IconReset,
} from '../../ui/icons';
import type { SeriesStack } from '../series/buildStacks';
import { checkVolume3dEligibility, hasWebGL2 } from './gate';
import { VOLUME3D_VIEWPORT_ID } from './layout';
import {
  DEFAULT_VOLUME3D_PRESET_ID,
  VOLUME3D_PRESETS,
  findVolume3dPreset,
} from './presets';
import type { Volume3dPreset } from './presets';
import {
  DEFAULT_VOLUME3D_QUALITY,
  INTERACTION_IDLE_MS,
  INTERACTION_LOW_QUALITY_MULTIPLIER,
  VOLUME3D_QUALITY_LEVELS,
  qualityMultiplierFor,
  sanitizeVolume3dQuality,
  volume3dQualityLabel,
} from './quality';
import type { Volume3dQualityLevel } from './quality';
import {
  createVolume3dToolGroup,
  destroyVolume3dToolGroup,
  initializeVolume3dTools,
} from './toolGroup';
import {
  applyClippingToViewport,
  applyPresetToViewport,
  applySampleDistanceMultiplier,
  applyWwWlToViewport,
  resetVolume3dCamera,
  screenshotVolume3d,
} from './apply';
import type { ClipState, VolumeActorLike } from './apply';
import { initializeDicomPipeline } from '../../dicom/init';
import {
  buildMprVolume,
  createRealMprVolumeDeps,
} from '../mpr/mprVolume';
import type { MprVolumeBuildDeps } from '../mpr/mprVolume';

/** 3D 共享 volume 的 id 前缀（完整 id：`vol3d-volume:<seriesUid>`；与 MPR 的 mpr-volume 隔离） */
export const VOLUME3D_VOLUME_ID_PREFIX = 'vol3d-volume';

/** 由序列 UID 生成稳定 volume id */
export function volume3dVolumeIdForSeries(seriesUid: string): string {
  return `${VOLUME3D_VOLUME_ID_PREFIX}:${seriesUid}`;
}

/** 与 2D/MPR 网格共享的应用级渲染引擎 */
export const VOLUME3D_ENGINE_ID = 'dicom-viewer-m1-engine';

type Volume3dStatus = 'initializing' | 'building' | 'ready' | 'error';

/** 裁剪滑杆范围（百分比 0..100，0 = 不裁剪） */
const CLIP_SLIDER_MAX = 100;

export interface Volume3dViewportProps {
  /** 进入 3D 时锁定的序列（App 按 seriesUid key 强制重挂） */
  stack: SeriesStack;
  seriesUid: string;
  showInfo: boolean;
  /** 2D 激活视口的当前窗宽窗位（2D→3D 联动，FR-7.3）；缺省时用预设初始窗 */
  linkedWwWl?: { ww: number; wl: number };
  /** 3D→2D 联动回调（联动开关开启时由 3D 变更触发） */
  onSyncWwWlTo2D?: (ww: number, wl: number) => void;
  /** 退出 3D（返回 2D 布局） */
  onExitVolume3d: () => void;
  /** 测试注入点：volume 组装依赖（默认真实装配） */
  volumeDeps?: MprVolumeBuildDeps;
  /** 测试注入点：WebGL2 能力（默认运行时检测） */
  webgl2?: boolean;
}

interface Vol3dViewportLike {
  getDefaultActor(): { actor?: VolumeActorLike } | undefined;
  getImageData(): {
    imageData?: { getBounds(): [number, number, number, number, number, number] };
    direction?: Float32Array | Float64Array;
    spacing?: [number, number, number];
  } | undefined;
  setProperties(properties: { voiRange: { lower: number; upper: number } }, volumeId?: string, suppressEvents?: boolean): void;
  setSampleDistanceMultiplier(multiplier: number): void;
  getCamera(): { parallelScale?: number; parallelProjection?: boolean };
  setCamera(camera: Record<string, unknown>, storeAsInitialCamera?: boolean): void;
  resetCamera?(): boolean;
  render?(): void;
  getCanvas(): { toDataURL(type?: string): string };
}

function getSharedRenderingEngine(engineId: string): RenderingEngine {
  return getRenderingEngine(engineId) ?? new RenderingEngine(engineId);
}

export function Volume3dViewport({
  stack,
  seriesUid,
  showInfo,
  linkedWwWl,
  onSyncWwWlTo2D,
  onExitVolume3d,
  volumeDeps: _volumeDeps,
  webgl2: webgl2Prop,
}: Volume3dViewportProps) {
  const defaultDeps = useMemo(() => createRealMprVolumeDeps(), []);
  const volumeDeps = _volumeDeps ?? defaultDeps;
  /** WebGL2 能力（可在测试注入；运行时检测一次） */
  const webgl2 = useMemo(() => webgl2Prop ?? hasWebGL2(), [webgl2Prop]);

  const [status, setStatus] = useState<Volume3dStatus>('initializing');
  const [buildError, setBuildError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string>(DEFAULT_VOLUME3D_PRESET_ID);
  const [quality, setQuality] = useState<Volume3dQualityLevel>(DEFAULT_VOLUME3D_QUALITY);
  const [ww, setWw] = useState(0);
  const [wl, setWl] = useState(0);
  const [wwDraft, setWwDraft] = useState('');
  const [wlDraft, setWlDraft] = useState('');
  const [syncTo2D, setSyncTo2D] = useState(false);
  const [clip, setClip] = useState<ClipState>({ axial: 0, coronal: 0, sagittal: 0 });

  const elementRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const viewportRef = useRef<Vol3dViewportLike | null>(null);
  const volumeRef = useRef<{ volumeId: string; removeFrameIpp: () => void } | null>(null);
  const disposedRef = useRef(false);
  /** 最近一次应用的窗宽窗位（联动对比/防循环用） */
  const lastWwWlRef = useRef<{ ww: number; wl: number }>({ ww: 0, wl: 0 });
  /** 质量档位镜像（渐进渲染定时器回调里读取，避免闭包过期） */
  const qualityRef = useRef<Volume3dQualityLevel>(DEFAULT_VOLUME3D_QUALITY);
  const progressiveTimerRef = useRef<number | null>(null);
  const lowQualityActiveRef = useRef(false);

  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  const dispose = useCallback(() => {
    disposedRef.current = true;
    if (progressiveTimerRef.current !== null) {
      window.clearTimeout(progressiveTimerRef.current);
      progressiveTimerRef.current = null;
    }
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
    viewportRef.current = null;
    const engine = engineRef.current;
    if (!engine) {
      return;
    }
    try {
      destroyVolume3dToolGroup(VOLUME3D_ENGINE_ID);
    } catch {
      // ToolGroup 未创建等场景：忽略
    }
    try {
      engine.disableElement(VOLUME3D_VIEWPORT_ID);
    } catch {
      // 视口未启用等场景：忽略
    }
    engineRef.current = null;
  }, []);

  // 挂载：门槛 → 初始化管线 → 启用 3D 视口 → 构建 volume → 装载 → 装配工具
  useEffect(() => {
    const gateResult = checkVolume3dEligibility(stack, webgl2);
    if (!gateResult.allowed) {
      setStatus('error');
      setBuildError(gateResult.message ?? '3D 不可用');
      return;
    }
    disposedRef.current = false;
    void (async () => {
      try {
        await Promise.all([initializeDicomPipeline(), initializeVolume3dTools()]);
        if (disposedRef.current) {
          return;
        }
        const engine = getSharedRenderingEngine(VOLUME3D_ENGINE_ID);
        engineRef.current = engine;
        const element = elementRef.current;
        if (!element) {
          throw new Error('3D 视口容器缺失');
        }
        engine.enableElement({
          viewportId: VOLUME3D_VIEWPORT_ID,
          element,
          type: Enums.ViewportType.VOLUME_3D,
          defaultOptions: {
            background: [0, 0, 0],
          },
        });

        setStatus('building');
        const volumeId = volume3dVolumeIdForSeries(seriesUid || stack.seriesUid);
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

        await setVolumesForViewports(engine, [{ volumeId: built.volumeId }], [VOLUME3D_VIEWPORT_ID]);
        if (disposedRef.current) {
          return;
        }
        const vp = engine.getViewport(VOLUME3D_VIEWPORT_ID) as Vol3dViewportLike;
        viewportRef.current = vp;

        createVolume3dToolGroup(VOLUME3D_ENGINE_ID);

        // 复位视角：默认轴位俯视（FR-7.9）
        resetVolume3dCamera(vp);

        // 初始窗宽窗位（优先联动 2D 当前值，否则用预设初始窗）；
        // 渲染预设由「预设切换」effect 在 ready 后应用（FR-7.2）
        const preset = findVolume3dPreset(presetId) ?? (VOLUME3D_PRESETS[0] as Volume3dPreset);
        const initial =
          linkedWwWl !== undefined && Number.isFinite(linkedWwWl.ww) && linkedWwWl.ww > 0
            ? { ww: linkedWwWl.ww, wl: linkedWwWl.wl }
            : { ww: preset.ww, wl: preset.wl };
        lastWwWlRef.current = initial;
        setWw(initial.ww);
        setWl(initial.wl);
        setWwDraft(String(initial.ww));
        setWlDraft(String(initial.wl));
        applyWwWlToViewport(vp, initial.ww, initial.wl);

        setStatus('ready');
      } catch (error) {
        console.error('[Volume3dViewport] 初始化失败', error);
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
  }, [stack, seriesUid, volumeDeps]);

  // 布局/窗口尺寸变化时按容器新尺寸重排 3D 视口（M11-F2，与 2D DicomViewport
  // 同一模式）：Cornerstone3D 仅在 enableElement 时按元素当时尺寸设置 canvas，
  // 其后容器变化（窗口缩放、面板收起、工具栏换行等）不会自动重算，需显式
  // renderingEngine.resize(immediate, keepCamera)。keepCamera=true 保留用户
  // 旋转/平移/缩放状态（WW/WL 为视口属性，不受影响）；immediate=true 时库内
  // 部会调度重新渲染。注意：MPR 视口目前没有同等处理（MprViewport TODO）。
  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let rafId = 0;
    // rAF 合并：过渡期间连续触发的回调只执行最后一次
    const scheduleResize = () => {
      if (rafId !== 0) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        try {
          engineRef.current?.resize(true, true); // immediate + keepCamera
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
    // elementRef/engineRef 均为 ref，不进依赖数组（观察挂载容器本身）
  }, []);

  // 预设切换（FR-7.2）：重赋色/不透明度传递函数，并保持当前窗宽窗位映射范围
  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const vp = viewportRef.current;
    const preset = findVolume3dPreset(presetId);
    if (!vp || !preset) {
      return;
    }
    void applyPresetToViewport(vp, preset).then(() => {
      const { ww: lastWw, wl: lastWl } = lastWwWlRefSafe();
      if (lastWw > 0 && Number.isFinite(lastWl)) {
        applyWwWlToViewport(vp, lastWw, lastWl);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, presetId]);

  function lastWwWlRefSafe(): { ww: number; wl: number } {
    const current = lastWwWlRef.current;
    if (current.ww > 0) {
      return current;
    }
    const preset = findVolume3dPreset(presetId);
    return preset ? { ww: preset.ww, wl: preset.wl } : { ww: 0, wl: 0 };
  }

  // 窗宽窗位：视口 VOI_MODIFIED → 刷新显示值（FR-7.3）
  useEffect(() => {
    if (status !== 'ready') {
      return undefined;
    }
    const element = elementRef.current;
    if (!element) {
      return undefined;
    }
    const onVoiModified = (event: Event) => {
      const detail = (event as CustomEvent<{ viewportId: string; range: Types.VOIRange }>)
        .detail;
      if (detail.viewportId !== VOLUME3D_VIEWPORT_ID) {
        return;
      }
      const range = detail.range;
      if (!range) {
        return;
      }
      const nextWw = Math.round((range.upper - range.lower) * 100) / 100;
      const nextWl = Math.round(((range.upper + range.lower) / 2) * 100) / 100;
      lastWwWlRef.current = { ww: nextWw, wl: nextWl };
      setWw(nextWw);
      setWl(nextWl);
    };
    element.addEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    return () => {
      element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoiModified);
    };
  }, [status]);

  // 2D→3D 联动（FR-7.3）：联动开启时 2D 窗宽窗位变化应用到 3D（防循环：与已应用值相同则跳过）
  useEffect(() => {
    if (status !== 'ready' || !syncTo2D) {
      return;
    }
    const vp = viewportRef.current;
    if (!vp || !linkedWwWl || linkedWwWl.ww <= 0 || !Number.isFinite(linkedWwWl.wl)) {
      return;
    }
    const { ww: lastWw, wl: lastWl } = lastWwWlRef.current;
    if (
      Math.abs(linkedWwWl.ww - lastWw) < 1e-6 &&
      Math.abs(linkedWwWl.wl - lastWl) < 1e-6
    ) {
      return;
    }
    applyWwWlToViewport(vp, linkedWwWl.ww, linkedWwWl.wl);
    lastWwWlRef.current = { ww: linkedWwWl.ww, wl: linkedWwWl.wl };
    setWw(linkedWwWl.ww);
    setWl(linkedWwWl.wl);
  }, [status, syncTo2D, linkedWwWl]);

  // 质量档位（FR-7.7）：采样距离倍数应用
  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const vp = viewportRef.current;
    if (!vp) {
      return;
    }
    applySampleDistanceMultiplier(vp, qualityMultiplierFor(quality));
  }, [status, quality]);

  // 渐进式渲染（FR-7.6）：交互（相机变化）时低质量预览，静止后恢复质量档位
  useEffect(() => {
    if (status !== 'ready') {
      return undefined;
    }
    const element = elementRef.current;
    const vp = viewportRef.current;
    if (!element || !vp) {
      return undefined;
    }
    const onCameraModified = () => {
      if (progressiveTimerRef.current !== null) {
        window.clearTimeout(progressiveTimerRef.current);
      }
      if (!lowQualityActiveRef.current) {
        applySampleDistanceMultiplier(vp, INTERACTION_LOW_QUALITY_MULTIPLIER);
        lowQualityActiveRef.current = true;
      }
      progressiveTimerRef.current = window.setTimeout(() => {
        applySampleDistanceMultiplier(vp, qualityMultiplierFor(qualityRef.current));
        lowQualityActiveRef.current = false;
        progressiveTimerRef.current = null;
      }, INTERACTION_IDLE_MS);
    };
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, onCameraModified);
    return () => {
      element.removeEventListener(Enums.Events.CAMERA_MODIFIED, onCameraModified);
      if (progressiveTimerRef.current !== null) {
        window.clearTimeout(progressiveTimerRef.current);
        progressiveTimerRef.current = null;
      }
      lowQualityActiveRef.current = false;
    };
  }, [status]);

  // 裁剪平面（FR-7.4）：轴/冠/矢三向滑杆 → volume mapper 硬件裁剪
  useEffect(() => {
    if (status !== 'ready') {
      return;
    }
    const vp = viewportRef.current;
    if (!vp) {
      return;
    }
    const imageData = vp.getImageData();
    const bounds = imageData?.imageData?.getBounds?.();
    const direction = imageData?.direction;
    if (!bounds || !direction) {
      return;
    }
    void applyClippingToViewport(vp, clip, { bounds, direction });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, clip.axial, clip.coronal, clip.sagittal]);

  const commitWwWl = useCallback(() => {
    const nextWw = Number(wwDraft);
    const nextWl = Number(wlDraft);
    if (!Number.isFinite(nextWw) || nextWw <= 0 || !Number.isFinite(nextWl)) {
      return;
    }
    const vp = viewportRef.current;
    if (!vp) {
      return;
    }
    applyWwWlToViewport(vp, nextWw, nextWl);
    lastWwWlRef.current = { ww: nextWw, wl: nextWl };
    setWw(nextWw);
    setWl(nextWl);
    if (syncTo2D) {
      onSyncWwWlTo2D?.(nextWw, nextWl);
    }
  }, [wwDraft, wlDraft, syncTo2D, onSyncWwWlTo2D]);

  const handleResetCamera = useCallback(() => {
    const vp = viewportRef.current;
    if (vp) {
      resetVolume3dCamera(vp);
    }
  }, []);

  const handleScreenshot = useCallback(() => {
    const vp = viewportRef.current;
    if (vp) {
      screenshotVolume3d(vp, `volume3d-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    }
  }, []);

  const toggleClip = useCallback((axis: keyof ClipState, value: number) => {
    setClip((prev) => ({ ...prev, [axis]: value }));
  }, []);

  // 覆盖信息用摘要：去掉 IOP，避免在 3D 视口显示误导性方向标记
  const overlaySummary = useMemo(() => {
    const summary = stack.items[0]?.summary;
    if (!summary) {
      return undefined;
    }
    return { ...summary, imageOrientationPatient: undefined };
  }, [stack]);

  const preset = findVolume3dPreset(presetId);

  return (
    <div className="mpr-root">
      <div className="mpr-bar">
        <span className="mpr-title">3D 体绘制</span>
        {/* M11-F3：3D 鼠标矩阵提示（左平/中窗/右旋/滚轮缩放） */}
        <span className="mpr-note">左键平移 · 中键调窗 · 右键旋转 · 滚轮缩放</span>
        <label className="mpr-field">
          渲染预设
          <select
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
            aria-label="3D 渲染预设"
            title={preset?.description}
          >
            {VOLUME3D_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mpr-field">
          质量
          <select
            value={quality}
            onChange={(event) => setQuality(sanitizeVolume3dQuality(event.target.value))}
            aria-label="3D 渲染质量"
          >
            {VOLUME3D_QUALITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {volume3dQualityLabel(level)}
              </option>
            ))}
          </select>
        </label>
        <label className="mpr-field">
          WW
          <input
            type="number"
            className="mpr-thickness-input"
            value={wwDraft}
            min={1}
            step={1}
            onChange={(event) => setWwDraft(event.target.value)}
            onBlur={commitWwWl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitWwWl();
              }
            }}
            aria-label="3D 窗宽"
          />
        </label>
        <label className="mpr-field">
          WL
          <input
            type="number"
            className="mpr-thickness-input"
            value={wlDraft}
            step={1}
            onChange={(event) => setWlDraft(event.target.value)}
            onBlur={commitWwWl}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitWwWl();
              }
            }}
            aria-label="3D 窗位"
          />
        </label>
        <label className="mpr-field">
          <input
            type="checkbox"
            checked={syncTo2D}
            onChange={(event) => setSyncTo2D(event.target.checked)}
            aria-label="3D 窗宽窗位联动 2D"
          />
          联动 2D
        </label>
        <label className="mpr-field">
          轴裁剪
          <input
            type="range"
            className="mpr-thickness-slider"
            min={0}
            max={CLIP_SLIDER_MAX}
            step={1}
            value={clip.axial ?? 0}
            onChange={(event) => toggleClip('axial', Number(event.target.value))}
            aria-label="3D 轴向裁剪"
          />
        </label>
        <label className="mpr-field">
          冠裁剪
          <input
            type="range"
            className="mpr-thickness-slider"
            min={0}
            max={CLIP_SLIDER_MAX}
            step={1}
            value={clip.coronal ?? 0}
            onChange={(event) => toggleClip('coronal', Number(event.target.value))}
            aria-label="3D 冠状裁剪"
          />
        </label>
        <label className="mpr-field">
          矢裁剪
          <input
            type="range"
            className="mpr-thickness-slider"
            min={0}
            max={CLIP_SLIDER_MAX}
            step={1}
            value={clip.sagittal ?? 0}
            onChange={(event) => toggleClip('sagittal', Number(event.target.value))}
            aria-label="3D 矢状裁剪"
          />
        </label>
        <button type="button" className="tool-button" onClick={handleResetCamera} title="复位视角（轴位俯视）">
          <IconReset />
          <span className="tool-button-label">复位视角</span>
        </button>
        <button type="button" className="tool-button" onClick={handleScreenshot} title="当前视角导出 PNG">
          <IconCamera />
          <span className="tool-button-label">截图</span>
        </button>
        <button
          type="button"
          className="tool-button"
          aria-label="退出 3D 体绘制"
          onClick={onExitVolume3d}
        >
          <IconExit />
          <span className="tool-button-label">退出 3D</span>
        </button>
      </div>

      <div className="viewer-grid-wrap mpr-grid-wrap">
        {/*
          * M11-F2 黑屏修复：与 MprViewport 同构，`.viewport-cell` 必须包在
          * `.viewer-grid`（styles.css：display:grid + width/height 100%，
          * 且 grid 轨道用 minmax(0,1fr) 允许收缩）内。缺这层包装时 cell 是
          * wrap（flex:1、min-height:0）下的 block 子元素，高度由内容决定
          * → canvas 容器 0 高 → vtk 按 0 高创建/适配 canvas → 主显示区全黑。
          */}
        <div
          className="viewer-grid"
          style={{
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
          }}
        >
          <div className="viewport-cell viewport-cell--active">
            <div
              className="cornerstone-element"
              ref={(element) => {
                elementRef.current = element;
              }}
              // M11-F4：屏蔽浏览器原生右键菜单（右键拖动旋转时干扰操作），
              // 仅 preventDefault，不拦截 mousedown/mousemove 事件流。
              onContextMenu={(event) => event.preventDefault()}
            />
            {status === 'ready' && showInfo && overlaySummary !== undefined && (
              <InfoOverlay
                summary={overlaySummary}
                sliceLabel="—"
                ww={ww}
                wl={wl}
                zoomPercent={0}
                probe={null}
              />
            )}
          </div>
        </div>

        {(status === 'initializing' || status === 'building') && (
          <div className="empty-hint" aria-live="polite">
            {status === 'initializing'
              ? '正在初始化 3D 渲染管线…'
              : `正在构建体数据…（${stack.items.length} 层）`}
          </div>
        )}
        {status === 'error' && (
          <div role="alert" className="viewport-error">
            3D 不可用:{buildError}
            <button
              type="button"
              className="tool-button"
              aria-label="返回 2D 阅片"
              onClick={onExitVolume3d}
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

export default Volume3dViewport;