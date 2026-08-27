/**
 * 应用壳：工具栏、全局快捷键、序列面板、多视口布局（FR-3.12 最小集）。
 *
 * - 布局：1×1 / 1×2 / 2×2（按钮 + 快捷键 1/2/4），各视口独立加载序列；
 * - 激活视口：点击视口切换；工具栏与快捷键作用于激活视口；
 * - 序列面板：点击序列加载到当前激活视口；拖拽序列卡片到指定视口放置加载
 *   （FR-2.8 单击语义 + 拖拽扩展）；
 * - M7：i18n 上下文（zh 默认，FR-12.3）、设置面板（FR-12 子集）、
 *   快捷键帮助浮层（FR-11）、缩略图分批生成（NFR-2）；
 * - M8：PACS 联网面板（FR-13 子集）：DICOMweb 配置/连接测试/QIDO 查询/
 *   WADO 拉取入序列树（来源标记「远程」）；
 * - M9：移动端适配（FR-14 子集）：窄屏抽屉式序列面板（≤767px，FR-14.2）、
 *   iOS 无文件夹选择提示与多选文件（FR-14.3）、低内存设备缩略图/缓存
 *   上限降级（FR-14.4）；触控手势映射与双击适应窗口在 toolSetup/
 *   DicomViewport 层实现（FR-14.1）。
 *
 * TODO(FR-14)：P1/P2 未做条目——双指窗宽窗位/旋转/长按防误触（FR-14.1）、
 * 横屏自动阅片布局与旋转保持验证（FR-14.11）、触控命中区 44px 精调与
 * 破坏性操作二次确认（FR-14.6）、3D 降质回退（FR-14.5）、信息字号自适应
 * 与状态栏折叠（FR-14.8）、PWA 启动画面（FR-14.7）。
 *
 * TODO(FR-12.3/NFR-9)：其余存量文案（进度条/toast/状态栏/错误报告等）迁入 i18n 词典。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cache, getRenderingEngine } from '@cornerstonejs/core';
import {
  openDicomFiles,
  type LoadFailure,
  type OpenedDicomFile,
} from '../features/loading/openDicomFiles';
import { dedupeBySopUid } from '../features/series/dedupe';
import { releaseAll, releaseSeries } from '../features/series/release';
import {
  batchGenerateThumbnails,
  generateThumbnail,
  setThumbnailMaxCount,
} from '../features/series/thumbnails';
import { getBufferForImageId } from '../dicom/imageId';
import {
  scanDroppedItems,
  scanDirectoryHandle,
  supportsDirectoryPicker,
  type DirectoryHandleLike,
  type ScannedFile,
} from '../features/loading/directoryScan';
import { ErrorReportPanel } from '../ui/components/ErrorReportPanel';
import { PacsPanel } from '../ui/components/PacsPanel';
import {
  loadPacsServers,
  savePacsServers,
  type PacsServerConfig,
} from '../features/pacs/config';
import {
  buildSeriesStacks,
  type SeriesStack,
  type StackItem,
} from '../features/series/buildStacks';
import {
  registerSourceBatch,
  getSourceBatch,
  listSourceBatches,
  clearSourceBatches,
  recordBatchOutcome,
} from '../features/series/sourceRegistry';
import {
  assessSeriesCompleteness,
  resolveRemoteContext,
} from '../features/series/seriesCompleteness';
import {
  decideSeriesEntry,
  type SeriesCandidateRow,
} from '../features/series/entryDecision';
import { fillFromDirectory, fillFromPacs } from '../features/series/fillSeries';
import { buildSeriesTree } from '../features/series/seriesTree';
import { SeriesPanel } from '../ui/components/SeriesPanel';
import { HelpOverlay } from '../ui/components/HelpOverlay';
import { SettingsPanel } from '../ui/components/SettingsPanel';
import {
  SeriesPickerDialog,
  type SeriesPickTarget,
  type SeriesPickerBusy,
} from '../ui/components/SeriesPickerDialog';
import { readMprReferenceCenter } from '../features/mpr/referenceLines';
import {
  CINE_DEFAULT_FPS,
  CINE_FPS_MAX,
  CINE_FPS_MIN,
  CinePlayer,
} from '../features/cine/cine';
import type { MprReferenceCenter, ViewportApi, ViewportUiState } from '../features/viewer/DicomViewport';
import { ViewerCell } from '../features/viewer/ViewerCell';
import { isSeriesDragEvent } from '../features/viewer/seriesDragDrop';
import { DEFAULT_PRIMARY_TOOL, ToolNames } from '../features/viewer/toolSetup';
import { MPR_CROSSHAIRS_TOOL } from '../features/mpr/mprToolGroup';
import { MprViewport } from '../features/mpr/MprViewport';
import { checkMprEligibility } from '../features/mpr/mprGate';
import {
  enterMprLayout,
  exitMprLayout,
  initialMprLayout,
} from '../features/mpr/mprLayout';
import type { MprLayoutState } from '../features/mpr/mprLayout';
import { Volume3dViewport } from '../features/volume3d/Volume3dViewport';
import { checkVolume3dEligibility, hasWebGL2 } from '../features/volume3d/gate';
import {
  enterVolume3dLayout,
  exitVolume3dLayout,
  initialVolume3dLayout,
} from '../features/volume3d/layout';
import type { Volume3dLayoutState } from '../features/volume3d/layout';
import {
  WW_WL_PRESETS,
  findPresetById,
  getDefaultWwWlForModality,
} from '../features/viewer/wwPresets';
import { isTextInputTarget, resolveShortcut } from '../features/shortcuts/shortcuts';
import {
  applySettingsEffects,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  type AppSettings,
} from '../features/settings/settings';
import {
  MOBILE_MEDIA_QUERY,
  useMediaQuery,
} from '../ui/hooks/useMediaQuery';
import { detectMobileFileAccess } from '../features/loading/mobileFileAccess';
import {
  adaptSettingsForDevice,
  detectDeviceProfile,
} from '../features/perf/deviceProfile';
import { I18nContext, translate, type I18nContextValue } from '../ui/i18n/i18n';
import {
  IconAnnotation,
  IconAngle,
  IconCalibrate,
  IconChevronLeft,
  IconChevronRight,
  IconCrosshair,
  IconWindowLevel,
  IconCobb,
  IconClose,
    IconEllipseRoi,
  IconFile,
  IconFit,
  IconFolderOpen,
  IconHelp,
  IconInfo,
  IconInvert,
  IconLayout1,
  IconLayout2,
  IconLayout4,
  IconMenu,
  IconMpr,
  IconOneToOne,
  IconPacs,
  IconPan,
  IconPause,
  IconPlay,
  IconRectRoi,
  IconRotateCcw,
  IconRotateCw,
  IconReset,
  IconRuler,
  IconSettings,
  IconSliders,
  IconStackScroll,
  IconStop,
  IconTrash,
  IconVolume3d,
  IconZoom,
  IconZoomIn,
  IconZoomOut,
} from '../ui/icons';
import { AnnotationsPanel } from '../features/measure/AnnotationsPanel';
import { CalibrationPanel } from '../features/measure/CalibrationPanel';
import {
  computeCalibrationScale,
  hasUsablePixelSpacing,
  calibratedSpacingForSeries,
  clearSeriesCalibration,
  setSeriesCalibration,
  formatCalibrationScale,
  type CalibrationCandidate,
} from '../features/measure/calibration';
import {
  firstCachedStats,
  snapshotAnnotations,
  asAnnotationList,
  toAnnotationExportFile,
  serializeAnnotationsJson,
  parseAnnotationExportFile,
  frameFromImageId,
  type AnnotationRow,
  type AnnotationLike,
} from '../features/measure/annotationModel';
import {
  buildAnnotationResolvers,
  removeAnnotationsForSeries,
  clearAllAnnotations,
  type AnnotationStateOps,
} from '../features/measure/annotationCleanup';
import { buildMeasurementSr, SR_TOOL_TYPE_MAP } from '../features/measure/srExport';
import { subscribeAnnotationEvents } from '../features/measure/annotationEvents';
import {
  ensureAnnotationRuntime,
  getAnnotationRuntime,
} from '../features/measure/annotationRuntime';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; done: number; total: number }
  | { status: 'loaded' }
  | { status: 'error'; message: string };

/** 文件数达到该阈值才展示进度条与取消按钮（FR-1.6），小批量直接加载 */
const PROGRESS_BAR_MIN_FILES = 20;

type LayoutKey = '1x1' | '1x2' | '2x2';

/** 布局档位定义（FR-3.12 P0 最小集） */
const LAYOUT_CONFIG: Readonly<Record<LayoutKey, { cells: number; columns: number }>> = {
  '1x1': { cells: 1, columns: 1 },
  '1x2': { cells: 2, columns: 2 },
  '2x2': { cells: 4, columns: 2 },
};
const LAYOUT_BY_CELLS: Readonly<Record<number, LayoutKey>> = {
  1: '1x1',
  2: '1x2',
  4: '2x2',
};
const ALL_VIEWPORT_IDS = ['vp-0', 'vp-1', 'vp-2', 'vp-3'] as const;

/** 布局按钮图标（M11 任务 4） */
const LAYOUT_ICONS: Readonly<Record<LayoutKey, JSX.Element>> = {
  '1x1': <IconLayout1 />,
  '1x2': <IconLayout2 />,
  '2x2': <IconLayout4 />,
};

/** 空视口共享的稳定空数组：保证 items/imageIds 引用稳定，避免 effect 反复重跑 */
const EMPTY_ITEMS: StackItem[] = [];

const EMPTY_UI: ViewportUiState = {
  sliceIndex: 0,
  sliceCount: 0,
  ww: 0,
  wl: 0,
  zoom: 1,
  invert: false,
  rotation: 0,
};

/** 视口 Cine 会话默认参数（FR-3.8） */
const CINE_DEFAULTS = { fps: CINE_DEFAULT_FPS, loop: true, reverse: false, playing: false };

/** cornerstone 标注运行时 addAnnotation 的安全包装 */
function annAddOrEmpty(
  rt: {
    addAnnotation?: (annotation: unknown, selector: unknown) => string | void;
  },
  annotation: unknown,
  selector: unknown,
): string {
  try {
    return rt.addAnnotation?.(annotation, selector) ?? '';
  } catch {
    return '';
  }
}

/** 取导入标注的 FrameOfReferenceUID（无则跳过该条不可恢复的标注） */
function addImportedAnnotations(
  entries: readonly unknown[],
  addFn: (annotation: unknown, annotationGroupSelector: unknown) => string | void,
): number {
  let added = 0;
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const annotation = entry as {
      annotationUID?: string;
      metadata?: { FrameOfReferenceUID?: string; referencedImageId?: string };
    };
    const forUid = annotation.metadata?.FrameOfReferenceUID;
    if (typeof forUid !== 'string' || forUid === '') {
      continue;
    }
    const uid = annotation.annotationUID ?? `imported-${Math.random().toString(36).slice(2)}`;
    const restored = { ...annotation, annotationUID: uid };
    try {
      addFn(restored, forUid);
      added += 1;
    } catch {
      // 单个标注恢复失败不影响其余
    }
  }
  return added;
}

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const [seriesList, setSeriesList] = useState<SeriesStack[]>([]);
  const [failures, setFailures] = useState<LoadFailure[]>([]);
  /** 视口 id → 已加载的序列 uid（null = 空视口） */
  const [assignments, setAssignments] = useState<Record<string, string | null>>(
    Object.fromEntries(ALL_VIEWPORT_IDS.map((id) => [id, null])),
  );
  const [layout, setLayout] = useState<LayoutKey>('1x1');
  const [activeViewportId, setActiveViewportId] = useState<string>('vp-0');
  /** MPR 三平面布局状态（FR-6.9）：on 时渲染 MprViewport，退出保留 2D 布局/加载状态 */
  const [mprLayout, setMprLayout] = useState<MprLayoutState>(initialMprLayout());
  /** 3D 体绘制布局状态（FR-7.1）：on 时渲染 Volume3dViewport，退出保留 2D 布局/加载状态 */
  const [vol3dLayout, setVol3dLayout] = useState<Volume3dLayoutState>(initialVolume3dLayout());
  /** 视口 id → 最近应用的窗宽窗位（3D 联动 FR-7.3 落地：覆盖默认窗，重挂视口时保持） */
  const [viewportWwWl, setViewportWwWl] = useState<Record<string, { ww: number; wl: number }>>(
    {},
  );
  /** 当前主拖动工具（M11-F3：null/默认 = 平移；测量/定位线激活时占左键） */
  const [primaryTool, setPrimaryTool] = useState<string>(DEFAULT_PRIMARY_TOOL);
  const [showInfo, setShowInfo] = useState(true);
  const [uiMap, setUiMap] = useState<Record<string, ViewportUiState>>({});
  /** WW/WL 输入框草稿（允许清空/中间态，失焦或回车时提交） */
  const [wwDraft, setWwDraft] = useState('');
  const [wlDraft, setWlDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  /** 序列 uid → 缩略图 dataURL（FR-2.4） */
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  /** 应用设置（FR-12 子集）：localStorage 持久化，挂载时应用主题与缓存上限 */
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** PACS 服务器配置（FR-13.1 子集）：localStorage 持久化 */
  const [pacsServers, setPacsServers] = useState<PacsServerConfig[]>(() => loadPacsServers());
  const [showPacs, setShowPacs] = useState(false);
  /** 窄屏（手机）判定：≤767px 时序列面板折叠为抽屉（FR-14.2） */
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  /** 移动端序列抽屉开合（仅窄屏使用） */
  const [seriesDrawerOpen, setSeriesDrawerOpen] = useState(false);
  /** 标注管理面板开合 + 选中标注（FR-5.9） */
  const [showAnnotationsPanel, setShowAnnotationsPanel] = useState(false);
  const [selectedAnnotationUid, setSelectedAnnotationUid] = useState<string | null>(null);
  /** 标注版本号：annotation 事件递增，驱动面板快照重算（FR-5.7 实时更新） */
  const [annotationsVersion, setAnnotationsVersion] = useState(0);
  /** 手动校准弹窗（FR-5.8） */
  const [showCalibration, setShowCalibration] = useState(false);
  /** MPR 跳转请求（FR-5.9/5.15：面板「跳转」→ 切到对应平面帧） */
  const [mprJump, setMprJump] = useState<{
    id: number;
    viewportId: string;
    sliceIndex: number;
  } | null>(null);
  /**
   * MPR/3D 进入前置的序列选择对话框（M11 任务 1）：多候选或当前序列
   * 未核对完整时弹出；busy 为补载进度；error 为补载失败提示（中文）。
   */
  const [seriesPick, setSeriesPick] = useState<{
    open: boolean;
    target: SeriesPickTarget | null;
    candidates: readonly SeriesCandidateRow[];
    busy: SeriesPickerBusy | null;
    error: string | null;
  }>({ open: false, target: null, candidates: [], busy: null, error: null });
  const seriesPickAbortRef = useRef<AbortController | null>(null);

  /** 文件打开能力（FR-14.3）：iOS 无文件夹选择 → 提示 + 多选文件引导 */
  const fileAccess = useMemo(
    () => detectMobileFileAccess(window.navigator.userAgent, window.navigator.maxTouchPoints),
    [],
  );
  /** 设备画像（FR-14.4）：低内存设备运行时降级缓存上限 */
  const deviceProfile = useMemo(() => detectDeviceProfile(window.navigator), []);

  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const apisRef = useRef<Map<string, ViewportApi>>(new Map());
  /** uiMap 镜像：供 CinePlayer 定时回调等异步流程读取最新帧状态 */
  const uiMapRef = useRef(uiMap);
  useEffect(() => {
    uiMapRef.current = uiMap;
  }, [uiMap]);
  /** Cine 播放器实例（每视口一个，FR-3.8） */
  const cinePlayersRef = useRef<Map<string, CinePlayer>>(new Map());
  /** 视口 id → Cine 会话 UI 状态（播放/速度/循环，供工具栏同步） */
  const [cineUi, setCineUi] = useState<
    Record<string, { playing: boolean; fps: number; loop: boolean; reverse: boolean }>
  >({});
  /** 切回 2D 后保留的 MPR 十字交点参考线（FR-6.10） */
  const [mprRefCenter, setMprRefCenter] = useState<MprReferenceCenter | null>(null);

  // webkitdirectory/directory 属性 React 不在类型中支持，挂载时手动设置（FR-1.2 Firefox/Safari 路径）
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  // ── 设置（FR-12 子集）────────────────────────────────
  /**
   * 变更设置：sanitize → 持久化 → 应用副作用（主题/图像缓存/缩略图 LRU）。
   * 副作用按设备画像降级后的值应用（FR-14.4）：降级仅运行时生效，
   * 持久化的始终是用户原始设置。
   */
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = sanitizeSettings({ ...prev, ...patch });
      saveSettings(next);
      applySettingsEffects(adaptSettingsForDevice(next, deviceProfile), {
        cacheApi: cache,
        setThumbnailLimit: setThumbnailMaxCount,
      });
      return next;
    });
  }, [deviceProfile]);

  // 挂载时应用已持久化的设置（主题 + 缩略图上限；
  // Cornerstone 缓存上限仅在设置面板变更时应用，避免管线未初始化时触碰 cache；
  // 低内存设备按画像降级缩略图上限，FR-14.4）
  useEffect(() => {
    applySettingsEffects(adaptSettingsForDevice(settings, deviceProfile), {
      setThumbnailLimit: setThumbnailMaxCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** i18n 上下文（FR-12.3）：语言跟随设置，默认 zh */
  const i18n = useMemo<I18nContextValue>(
    () => ({
      lang: settings.language,
      setLang: (next) => updateSettings({ language: next }),
      t: (key, vars) => translate(settings.language, key, vars),
    }),
    [settings.language, updateSettings],
  );
  const { t } = i18n;

  // ── 视口注册与状态收集 ──────────────────────────────
  const registerApi = useCallback((id: string, api: ViewportApi | null) => {
    if (api === null) {
      apisRef.current.delete(id);
    } else {
      apisRef.current.set(id, api);
    }
  }, []);
  const handleUiChange = useCallback((id: string, ui: ViewportUiState) => {
    setUiMap((prev) => ({ ...prev, [id]: ui }));
    // 记录最近应用的 WW/WL（3D 联动/重挂视口保持，FR-7.3）
    if (ui.ww > 0 && Number.isFinite(ui.wl)) {
      setViewportWwWl((prev) => {
        const current = prev[id];
        if (current && current.ww === ui.ww && current.wl === ui.wl) {
          return prev;
        }
        return { ...prev, [id]: { ww: ui.ww, wl: ui.wl } };
      });
    }
  }, []);

  const activeApi = apisRef.current.get(activeViewportId) ?? null;
  const activeUi = uiMap[activeViewportId] ?? EMPTY_UI;
  const hasStack = activeUi.sliceCount > 0;
  /** 当前激活视口的 Cine 会话 UI（FR-3.8） */
  const activeCine = cineUi[activeViewportId] ?? CINE_DEFAULTS;

  // ── 标注数据（FR-5.9/5.10/5.11）────────────────────────
  /** cornerstone 标注状态操作（每次调用读运行时，兼容异步加载；缺 mocks 时 no-op） */
  const annotationOps = useMemo<AnnotationStateOps>(
    () => ({
      getAllAnnotations: () =>
        (getAnnotationRuntime().getAllAnnotations?.() as readonly AnnotationLike[] | undefined) ?? [],
      removeAnnotation: (uid) => {
        const rt = getAnnotationRuntime();
        if (rt.removeAnnotation) {
          rt.removeAnnotation(uid);
          return true;
        }
        return false;
      },
      addAnnotation: (annotation, selector) =>
        annAddOrEmpty(getAnnotationRuntime(), annotation, selector),
    }),
    [],
  );

  /** 异步加载 cornerstone 标注运行时；就绪后刷新面板（防首次渲染为空） */
  useEffect(() => {
    ensureAnnotationRuntime(() => setAnnotationsVersion((version) => version + 1));
  }, []);

  /** imageId → 序列/帧/SOP/间距 + seriesUid → 视口的解析器（由已加载序列构建） */
  const annotationResolvers = useMemo(
    () => buildAnnotationResolvers({ stacks: seriesList, assignments }),
    [seriesList, assignments],
  );

  /** 面板行数据：物理可用性融合「原始间隔 + 会话校准」（FR-5.8） */
  const annotationRows = useMemo<AnnotationRow[]>(() => {
    const rows = snapshotAnnotations(asAnnotationList(annotationOps.getAllAnnotations()), {
      ...annotationResolvers,
      resolveSpacing: (imageId) => {
        const raw = annotationResolvers.resolveSpacing(imageId);
        if (raw !== undefined) {
          return raw;
        }
        const series = annotationResolvers.resolveSeries(imageId);
        return calibratedSpacingForSeries(series);
      },
      mprActive: mprLayout.mode === 'on',
    });
    return rows;
    // annotationsVersion 由 annotation 事件递增，驱动实时刷新（FR-5.7）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsVersion, annotationOps, annotationResolvers, mprLayout.mode]);

  /** 标注事件订阅：新增/拖动修改/删除/选中变更 → 刷新面板快照（FR-5.7/5.9） */
  useEffect(() => {
    const unsubscribe = subscribeAnnotationEvents(() => {
      // 同步 cornerstone 选中态到面板选中行（FR-5.9 选中高亮）
      const rt = getAnnotationRuntime();
      const selected = rt.getSelected?.() ?? [];
      setSelectedAnnotationUid(
        selected.length > 0 ? (selected[selected.length - 1] ?? null) : null,
      );
      setAnnotationsVersion((version) => version + 1);
    });
    return unsubscribe;
  }, []);

  // ── 文件打开 ────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  /** 跨批次累积的已解析实例（FR-1.11 去重后追加） */
  const openedFilesRef = useRef<OpenedDicomFile[]>([]);
  /** 已加载的 SOPInstanceUID 集合（跨批次去重依据） */
  const knownUidsRef = useRef<Set<string>>(new Set());
  /** assignments 镜像：供异步流程读取最新指派状态而不重建回调 */
  const assignmentsRef = useRef(assignments);
  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  /**
   * 已解析实例并入既有管线（M11 提炼公共合并路径）：
   * SOPInstanceUID 去重 → 追加累积表 → 重建序列堆栈。
   * 三个入口（本地打开/远程拉取/进入重建前补载）共用。
   */
  const appendOpenedFiles = useCallback(
    (opened: readonly OpenedDicomFile[]) => {
      const deduped = dedupeBySopUid([...opened], knownUidsRef.current);
      knownUidsRef.current = deduped.nextUids;
      openedFilesRef.current = [...openedFilesRef.current, ...deduped.kept];
      setSeriesList(buildSeriesStacks(openedFilesRef.current));
      return deduped;
    },
    [],
  );

  const handleFiles = useCallback(
    async (
      inputs: readonly (ScannedFile | File)[],
      provenance?: {
        kind: 'directory' | 'file-list';
        label: string;
        directoryHandle?: DirectoryHandleLike;
      },
    ) => {
      if (inputs.length === 0) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadState({ status: 'loading', done: 0, total: inputs.length });
      // 来源登记（M11 任务 1）：directory 批次保留句柄供进入 MPR/3D 时重扫补齐
      const batchId = registerSourceBatch(
        provenance?.kind === 'directory'
          ? {
              kind: 'directory',
              label: provenance.label,
              scannedCount: inputs.length,
              directoryHandle: provenance.directoryHandle,
            }
          : {
              kind: 'file-list',
              label: provenance?.label ?? '手动选择文件',
              scannedCount: inputs.length,
            },
      );
      try {
        const {
          opened,
          failures: failed,
          cancelled,
        } = await openDicomFiles(inputs, {
          signal: controller.signal,
          onProgress: (done, total) => {
            // 仅最新一次打开操作有权更新进度（防止快速连续打开时旧任务回写）
            if (abortRef.current === controller) {
              setLoadState({ status: 'loading', done, total });
            }
          },
        });
        // FR-1.11 去重：SOPInstanceUID 已存在（历史批次或本批次内）则跳过
        const deduped = appendOpenedFiles(opened);
        recordBatchOutcome(batchId, {
          completed: !cancelled,
          failedNames: failed.map((failure) => failure.fileName),
          openedFiles: deduped.kept.map((file) => ({
            fileName: file.fileName,
            fileSizeBytes: file.fileSizeBytes,
            seriesInstanceUid: file.summary.seriesInstanceUid,
          })),
        });
        setFailures(failed);
        if (deduped.duplicateCount > 0) {
          showToast(`已跳过 ${deduped.duplicateCount} 个重复文件`);
        }
        const stacks = buildSeriesStacks(openedFilesRef.current);
        if (stacks.length === 0) {
          setLoadState(
            cancelled
              ? { status: 'idle' }
              : {
                  status: 'error',
                  message: failed[0]?.message ?? '没有可显示的 DICOM 文件',
                },
          );
          if (cancelled) {
            showToast('已取消打开');
          }
          return;
        }
        // 仅当当前没有任何视口加载数据时自动指派首个序列（累积加载不打断已有视图）
        const anyLoaded = Object.values(assignmentsRef.current).some((uid) => uid !== null);
        if (!anyLoaded || cancelled) {
          const firstUid = stacks[0]?.seriesUid ?? null;
          setAssignments(
            Object.fromEntries(ALL_VIEWPORT_IDS.map((id) => [id, id === 'vp-0' ? firstUid : null])),
          );
          setActiveViewportId('vp-0');
        }
        setLoadState({ status: 'loaded' });
        if (cancelled) {
          showToast(`已取消：保留已解析的 ${opened.length} 个文件`);
        }
      } catch (error) {
        console.error('[App] 打开文件失败', error);
        setLoadState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [appendOpenedFiles, showToast],
  );

  /** 取消当前解析：保留已完成的文件，丢弃未开始的（FR-1.6） */
  const cancelLoading = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** PACS 服务器配置变更：更新状态并持久化（FR-13.1，重启应用后仍在） */
  const handlePacsServersChange = useCallback((servers: PacsServerConfig[]) => {
    setPacsServers(servers);
    savePacsServers(servers);
  }, []);

  /**
   * 远程拉取的实例并入现有序列树（FR-13.6）：
   * 与本地文件共用去重/注册表/序列堆栈管线（解析已在 PACS 面板完成）。
   * M11 任务 1：登记 remote 批次（服务器配置快照），供进入 MPR/3D 时
   * 按 SeriesUID 核对并补拉缺失实例。
   */
  const handleRemoteStudies = useCallback(
    (
      opened: OpenedDicomFile[],
      remote?: { serverName: string; studyUid: string; config: PacsServerConfig },
    ) => {
      if (opened.length === 0) {
        return;
      }
      const batchId = registerSourceBatch(
        remote
          ? {
              kind: 'remote',
              label: `远程 · ${remote.serverName}`,
              scannedCount: opened.length,
              remote,
            }
          : {
              kind: 'remote',
              label: '远程拉取',
              scannedCount: opened.length,
            },
      );
      const deduped = appendOpenedFiles(opened);
      recordBatchOutcome(batchId, {
        completed: true,
        openedFiles: deduped.kept.map((file) => ({
          fileName: file.fileName,
          fileSizeBytes: file.fileSizeBytes,
          seriesInstanceUid: file.summary.seriesInstanceUid,
        })),
      });
      const stacks = buildSeriesStacks(openedFilesRef.current);
      const anyLoaded = Object.values(assignmentsRef.current).some((uid) => uid !== null);
      if (!anyLoaded) {
        const firstUid = stacks[0]?.seriesUid ?? null;
        setAssignments(
          Object.fromEntries(ALL_VIEWPORT_IDS.map((id) => [id, id === 'vp-0' ? firstUid : null])),
        );
        setActiveViewportId('vp-0');
      }
      setLoadState({ status: 'loaded' });
    },
    [appendOpenedFiles, showToast],
  );

  /** 「打开文件夹」：Chromium 走 File System Access API，其余浏览器走 webkitdirectory 输入框 */
  const openFolder = useCallback(async () => {
    if (!supportsDirectoryPicker()) {
      folderInputRef.current?.click();
      return;
    }
    try {
      const handle = await window.showDirectoryPicker?.({ mode: 'read' });
      if (!handle) {
        return;
      }
      const scanned = await scanDirectoryHandle(handle as unknown as DirectoryHandleLike);
      // M11 任务 1：目录句柄登记到来源批次，进入 MPR/3D 时可重扫补齐同序列未打开文件
      void handleFiles(scanned, {
        kind: 'directory',
        label: handle.name || '所选文件夹',
        directoryHandle: handle as unknown as DirectoryHandleLike,
      });
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') {
        return; // 用户取消选择
      }
      console.error('[App] 打开文件夹失败', error);
      setLoadState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [handleFiles]);

  // 全窗口拖拽入口（FR-1.1）；内部序列卡片拖拽（自定义 MIME）不触发文件打开 UI
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
    };
    const onDragEnter = (event: DragEvent) => {
      if (isSeriesDragEvent(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (isSeriesDragEvent(event)) {
        return;
      }
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDragActive(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      // 内部序列拖拽由视口单元格处理，不走文件打开
      if (isSeriesDragEvent(event)) {
        return;
      }
      void (async () => {
        try {
          const result = await scanDroppedItems(event.dataTransfer);
          if (result.needsPickerFallback) {
            showToast('当前浏览器不支持拖拽文件夹，请使用「打开文件夹」按钮');
            return;
          }
          await handleFiles(result.files, { kind: 'file-list', label: '拖入文件' });
        } catch (error) {
          console.error('[App] 读取拖入的文件/文件夹失败', error);
          showToast('读取拖入内容失败，请改用「打开文件」按钮');
        }
      })();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles, showToast]);

  // ── 派生数据 ────────────────────────────────────────
  const stackByUid = useMemo(() => {
    const map = new Map<string, SeriesStack>();
    for (const stack of seriesList) {
      map.set(stack.seriesUid, stack);
    }
    return map;
  }, [seriesList]);

  const activeStack =
    activeViewportId !== null
      ? (stackByUid.get(assignments[activeViewportId] ?? '') ?? null)
      : null;

  /** 当前激活序列的 MPR 数据门槛判定（FR-6.7）：不可用时禁用入口并提示原因 */
  const activeMprGate = useMemo(
    () => checkMprEligibility(activeStack),
    [activeStack],
  );

  /**
   * WebGL2 能力（FR-7.1，M11 任务 2 修复）：
   * 原实现为「首次渲染一次性探测并永久缓存」——启动早期 GPU 进程繁忙或
   * 上下文暂不可用时得到 false，且之后不再重试，3D 入口按钮被静默禁用
   * （点击无任何反应、仅悬停提示）。改为可重探：值变化驱动门槛/按钮刷新，
   * 窗口聚焦与入口尝试时重探（已可用则跳过探测开销）。
   */
  const [webgl2, setWebgl2Capable] = useState<boolean>(() => hasWebGL2());
  const webgl2Ref = useRef(webgl2);
  /** 重探 WebGL2 并同步状态；返回最新能力值（供同一 tick 内的入口判定使用） */
  const reprobeWebGL2 = useCallback((): boolean => {
    // 直接调用可注入的 hasWebGL2（gate 内部互引不走 mock，测试与运行时一致）
    const next = webgl2Ref.current ? true : hasWebGL2();
    if (next !== webgl2Ref.current) {
      webgl2Ref.current = next;
      setWebgl2Capable(next);
    }
    return next;
  }, []);
  // 启动早期探测失败：本 effect 在能力仍为 false 时兜底重探一次
  useEffect(() => {
    if (!webgl2) {
      reprobeWebGL2();
    }
  }, [webgl2, reprobeWebGL2]);
  // 窗口聚焦重探：GPU 进程恢复/用户外接显卡等场景自动解除误禁用
  useEffect(() => {
    const onFocus = () => {
      // eslint-disable-next-line no-console
      console.log('[debug] window focus -> reprobe');
      // eslint-disable-next-line no-console
      console.log('[debug] window focus -> reprobe');
      reprobeWebGL2();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reprobeWebGL2]);

  /** 当前激活序列的 3D 门槛判定（FR-7.1，数据 + WebGL2） */
  const activeVol3dGate = useMemo(
    () => checkVolume3dEligibility(activeStack, webgl2),
    [activeStack, webgl2],
  );

  /** MPR 模式锁定的渲染序列（进入时快照；关闭/清空后为 null → 回落 2D 网格） */
  const mprStack =
    mprLayout.mode === 'on' && mprLayout.seriesUid !== null
      ? (stackByUid.get(mprLayout.seriesUid) ?? null)
      : null;

  /** 3D 模式锁定的渲染序列（进入时快照；关闭/清空后为 null → 回落 2D 网格） */
  const vol3dStack =
    vol3dLayout.mode === 'on' && vol3dLayout.seriesUid !== null
      ? (stackByUid.get(vol3dLayout.seriesUid) ?? null)
      : null;

  /** 指定堆栈的默认窗宽窗位（文件自带优先，其次模态预设；3D 联动覆盖值最优先，FR-7.3） */
  const getDefaultWwWl = useCallback(
    (stack: SeriesStack | null, viewportId?: string) => {
      if (stack === null) {
        return undefined;
      }
      const override = viewportId !== undefined ? viewportWwWl[viewportId] : undefined;
      if (override && override.ww > 0) {
        return { ww: override.ww, wl: override.wl };
      }
      const summary = stack.items[0]?.summary;
      return getDefaultWwWlForModality(summary?.modality ?? '', {
        windowWidth: summary?.windowWidth,
        windowCenter: summary?.windowCenter,
      });
    },
    [viewportWwWl],
  );

  const totalInstances = seriesList.reduce((sum, s) => sum + s.items.length, 0);

  /** 患者→检查→序列树（FR-2.1） */
  const patientTree = useMemo(() => buildSeriesTree(seriesList), [seriesList]);

  // 缩略图分批懒生成（FR-2.4 + NFR-2）：跳过缓存命中项；每批（默认 10 个）
  // 之间让出主线程，避免大序列列表卡 UI；缓存上限由设置控制（FR-12.5）。
  useEffect(() => {
    let disposed = false;
    const items = seriesList.map((stack) => ({
      seriesUid: stack.seriesUid,
      source: stack.items[0]?.imageId,
    }));
    void batchGenerateThumbnails(
      items,
      (item) => {
        const imageId = item.source;
        if (typeof imageId !== 'string' || imageId === '') {
          return null;
        }
        return generateThumbnail(getBufferForImageId(imageId));
      },
      {
        onUpdate: (updates) => {
          if (!disposed) {
            setThumbnails((prev) => ({ ...prev, ...updates }));
          }
        },
      },
    );
    return () => {
      disposed = true;
    };
  }, [seriesList]);

  // ── 动作（工具栏 + 快捷键共用） ────────────────────
  const activateTool = useCallback(
    (toolName: string) => {
      // M11-F3：默认主工具=平移（Pan）。再次点击已激活工具 → 回归默认平移
      const next =
        toolName !== DEFAULT_PRIMARY_TOOL && primaryTool === toolName
          ? DEFAULT_PRIMARY_TOOL
          : toolName;
      setPrimaryTool(next);
      apisRef.current.get(activeViewportId)?.setPrimaryTool(next);
    },
    [activeViewportId, primaryTool],
  );

  // ── Cine 播放（FR-3.8，M10-E）────────────────────────
  /** 取（或创建）指定视口的 CinePlayer；宿主回调全部经 ref 读取最新状态 */
  const getCinePlayer = useCallback((viewportId: string): CinePlayer => {
    let player = cinePlayersRef.current.get(viewportId);
    if (player) {
      return player;
    }
    player = new CinePlayer(
      {
        getFrameCount: () => uiMapRef.current[viewportId]?.sliceCount ?? 0,
        getCurrentIndex: () => uiMapRef.current[viewportId]?.sliceIndex ?? 0,
        onFrame: (index) => {
          apisRef.current.get(viewportId)?.setImageIndex(index);
        },
        onStateChange: (state) => {
          setCineUi((prev) => {
            const cur = prev[viewportId];
            if (
              cur &&
              cur.playing === state.playing &&
              cur.fps === state.fps &&
              cur.loop === state.loop &&
              cur.reverse === state.reverse
            ) {
              return prev;
            }
            return {
              ...prev,
              [viewportId]: {
                playing: state.playing,
                fps: state.fps,
                loop: state.loop,
                reverse: state.reverse,
              },
            };
          });
        },
      },
      { fps: CINE_DEFAULT_FPS, loop: true },
    );
    cinePlayersRef.current.set(viewportId, player);
    return player;
  }, []);

  const stopAllCine = useCallback(() => {
    cinePlayersRef.current.forEach((player) => player.stop());
  }, []);

  const toggleCine = useCallback(
    (viewportId: string) => {
      const count = uiMapRef.current[viewportId]?.sliceCount ?? 0;
      if (count <= 1) {
        showToast('当前序列只有一帧，无需 Cine 播放');
        return;
      }
      getCinePlayer(viewportId).togglePlay();
    },
    [getCinePlayer, showToast],
  );

  const stopCine = useCallback(
    (viewportId: string) => {
      getCinePlayer(viewportId).stop();
    },
    [getCinePlayer],
  );

  const setCineSpeed = useCallback(
    (viewportId: string, fps: number) => {
      getCinePlayer(viewportId).setFps(fps);
    },
    [getCinePlayer],
  );

  const setCineLoop = useCallback(
    (viewportId: string, loop: boolean) => {
      getCinePlayer(viewportId).setLoop(loop);
    },
    [getCinePlayer],
  );

  // 视口 WW/WL 变化（拖动/预设/重置）→ 同步输入框草稿与预设选中态
  useEffect(() => {
    setWwDraft(String(activeUi.ww));
    setWlDraft(String(activeUi.wl));
  }, [activeUi.ww, activeUi.wl]);

  const activePresetId = useMemo(
    () => WW_WL_PRESETS.find((p) => p.ww === activeUi.ww && p.wl === activeUi.wl)?.id ?? '',
    [activeUi.ww, activeUi.wl],
  );

  /** 提交输入框草稿为窗宽窗位；非法值回退到当前生效值 */
  const commitWwWlDraft = useCallback(() => {
    const ww = Number(wwDraft);
    const wl = Number(wlDraft);
    if (Number.isFinite(ww) && ww > 0 && Number.isFinite(wl)) {
      apisRef.current.get(activeViewportId)?.applyWwWl(ww, wl);
    } else {
      setWwDraft(String(activeUi.ww));
      setWlDraft(String(activeUi.wl));
    }
  }, [wwDraft, wlDraft, activeUi.ww, activeUi.wl, activeViewportId]);

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = findPresetById(presetId);
      if (preset) {
        apisRef.current.get(activeViewportId)?.applyWwWl(preset.ww, preset.wl);
      }
    },
    [activeViewportId],
  );

  const loadSeriesTo = useCallback((viewportId: string, seriesUid: string) => {
    setAssignments((prev) => ({ ...prev, [viewportId]: seriesUid }));
  }, []);

  /** 关闭单个序列：清空引用它的视口 + 释放图像缓存与内存缓冲（FR-2.9）；
   * 同时清理该序列产生的标注与校准登记（FR-5.10）。 */
  const closeSeries = useCallback(
    (seriesUid: string) => {
      const stack = stackByUid.get(seriesUid);
      if (!stack) {
        return;
      }
      // 序列关闭 → 按 imageId 归属清理标注（前置：resolver 还持有该序列映射）
      const removedCount = removeAnnotationsForSeries(
        seriesUid,
        annotationOps,
        annotationResolvers.resolveSeries,
      );
      clearSeriesCalibration(seriesUid);
      if (removedCount > 0) {
        setSelectedAnnotationUid((prev) => prev ?? null);
        setAnnotationsVersion((version) => version + 1);
      }
      setAssignments((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([id, uid]) => [id, uid === seriesUid ? null : uid]),
        ),
      );
      // MPR 锁定的是该序列时同步退出三平面布局（FR-6.9）
      if (mprLayout.mode === 'on' && mprLayout.seriesUid === seriesUid) {
        setMprLayout(exitMprLayout(mprLayout));
      }
      // 关闭的是参考线所属序列时清除参考线（FR-6.10）
      if (mprRefCenter !== null && mprRefCenter.seriesUid === seriesUid) {
        setMprRefCenter(null);
      }
      // 3D 锁定的是该序列时同步退出体绘制布局（FR-7.1）
      if (vol3dLayout.mode === 'on' && vol3dLayout.seriesUid === seriesUid) {
        setVol3dLayout(exitVolume3dLayout(vol3dLayout));
      }
      // 从累积数据中移除该序列的实例，并撤销其 SOPInstanceUID 去重标记（允许重新打开）
      const removedFiles = openedFilesRef.current.filter(
        (file) => (file.summary.seriesInstanceUid ?? `__file__:${file.fileName}`) === seriesUid,
      );
      openedFilesRef.current = openedFilesRef.current.filter(
        (file) => (file.summary.seriesInstanceUid ?? `__file__:${file.fileName}`) !== seriesUid,
      );
      for (const file of removedFiles) {
        if (file.summary.sopInstanceUid) {
          knownUidsRef.current.delete(file.summary.sopInstanceUid);
        }
      }
      setSeriesList((prev) => prev.filter((s) => s.seriesUid !== seriesUid));
      void releaseSeries(stack).then(() => showToast('已关闭序列并释放内存'));
    },
    [annotationOps, annotationResolvers, mprLayout, mprRefCenter, showToast, stackByUid, vol3dLayout],
  );

  /** 清空全部数据集（FR-2.9）：二次确认后释放所有缓存与注册表 */
  const clearAll = useCallback(() => {
    if (!window.confirm('确定要清空所有已加载的数据吗？将释放全部图像缓存与内存。')) {
      return;
    }
    stopAllCine();
    setMprRefCenter(null);
    setAssignments(Object.fromEntries(ALL_VIEWPORT_IDS.map((id) => [id, null])));
    if (mprLayout.mode === 'on') {
      setMprLayout(exitMprLayout(mprLayout));
    }
    if (vol3dLayout.mode === 'on') {
      setVol3dLayout(exitVolume3dLayout(vol3dLayout));
    }
    openedFilesRef.current = [];
    knownUidsRef.current = new Set();
    // 同步清空序列来源登记（M11 任务 1）
    clearSourceBatches();
    // 清空标注状态与全部校准登记（FR-5.10/5.9）
    clearAllAnnotations(annotationOps);
    for (const stack of seriesList) {
      clearSeriesCalibration(stack.seriesUid);
    }
    setSelectedAnnotationUid(null);
    setAnnotationsVersion((version) => version + 1);
    setSeriesList([]);
    setFailures([]);
    setUiMap({});
    setThumbnails({});
    setLoadState({ status: 'idle' });
    void releaseAll(seriesList).then(() => showToast('已清空全部数据'));
  }, [annotationOps, mprLayout, seriesList, showToast, stopAllCine, vol3dLayout]);

  const loadSeriesToViewport = useCallback(
    (seriesUid: string) => {
      loadSeriesTo(activeViewportId, seriesUid);
    },
    [activeViewportId, loadSeriesTo],
  );

  const switchLayout = useCallback((cells: number) => {
    const key = LAYOUT_BY_CELLS[cells];
    if (key === undefined) {
      return;
    }
    // 布局切换：停止全部 Cine 播放，避免隐藏视口继续空转
    stopAllCine();
    setLayout(key);
    setActiveViewportId((prev) =>
      ALL_VIEWPORT_IDS.slice(0, cells).includes(prev as (typeof ALL_VIEWPORT_IDS)[number])
        ? prev
        : 'vp-0',
    );
  }, [stopAllCine]);

  /** 一键「单轴向 ⇄ 三平面」（FR-6.9）：进入时锁定量激活序列并快照 2D 布局 */
  /**
   * 退出 MPR 前捕获十字交点 → 2D 视口画参考线（FR-6.10）。
   * 在卸载 MprViewport（disableElement）之前同步读取轴向视口 camera，故须
   * 在 onExitMpr 与工具栏 toggleMpr 两条退出路径都显式调用，不能放在 effect。
   */
  const exitMprAndCapture = useCallback(() => {
    const seriesUid = mprLayout.seriesUid;
    const engine = getRenderingEngine('dicom-viewer-m1-engine');
    const center = readMprReferenceCenter(engine as never);
    if (center !== null && seriesUid !== null) {
      setMprRefCenter({ seriesUid, world: center });
    }
    setMprLayout((prev) => exitMprLayout(prev));
  }, [mprLayout]);

  // M11-F3：定位线是 MPR 专属主工具——任何退出 MPR 的路径（退出按钮/关序列/
  // 清空全部）都回归默认平移，避免把 2D 工具组不存在的工具名残留到主工具状态
  useEffect(() => {
    if (mprLayout.mode !== 'on' && primaryTool === MPR_CROSSHAIRS_TOOL) {
      setPrimaryTool(DEFAULT_PRIMARY_TOOL);
    }
  }, [mprLayout.mode, primaryTool]);

  /**
   * 序列完整性评估（进入 MPR/3D 时使用，M11 任务 1）：
   * 远程上下文解析失败也归属「未核对」，原因文案优先展示配置问题。
   */
  const assessForEntry = useCallback(
    (stack: SeriesStack): { needsCheck: boolean; reason?: string } => {
      const info = assessSeriesCompleteness(stack);
      if (info.fillKind === 'pacs') {
        const resolved = resolveRemoteContext(info, stack, pacsServers);
        return { needsCheck: info.needsCheck, reason: resolved.error ?? info.reason };
      }
      return { needsCheck: info.needsCheck, reason: info.reason };
    },
    [pacsServers],
  );

  /** 进入 MPR 布局（含互斥退出 3D / 停 Cine / 清参考线） */
  const applyMprLayoutFor = useCallback(
    (seriesUid: string) => {
      setVol3dLayout((prev) =>
        prev.mode === 'on' ? exitVolume3dLayout(prev) : prev,
      );
      stopAllCine();
      setMprRefCenter(null);
      setMprLayout((prev) =>
        prev.mode === 'on' ? prev : enterMprLayout(prev, seriesUid, LAYOUT_CONFIG[layout].cells),
      );
    },
    [layout, stopAllCine],
  );

  /** 进入 3D 布局（含互斥退出 MPR / 停 Cine） */
  const applyVol3dLayoutFor = useCallback(
    (seriesUid: string) => {
      setMprLayout((prev) => (prev.mode === 'on' ? exitMprLayout(prev) : prev));
      stopAllCine();
      setVol3dLayout((prev) =>
        prev.mode === 'on'
          ? prev
          : enterVolume3dLayout(prev, seriesUid, LAYOUT_CONFIG[layout].cells),
      );
    },
    [layout, stopAllCine],
  );

  /** 关闭序列选择器并中止进行中的补载 */
  const closeSeriesPick = useCallback(() => {
    seriesPickAbortRef.current?.abort();
    seriesPickAbortRef.current = null;
    setSeriesPick({
      open: false,
      target: null,
      candidates: [],
      busy: null,
      error: null,
    });
  }, []);

  /**
   * 选定序列 → 从完整来源核对并补载全部实例 → 重跑门槛 → 进入布局。
   * M11 任务 1 核心：volume 构建不再依赖「当前已打开的可见层面」。
   */
  const confirmSeriesEntry = useCallback(
    async (target: SeriesPickTarget, seriesUid: string) => {
      const controller = new AbortController();
      seriesPickAbortRef.current = controller;
      try {
        const from = <T,>(stacks: readonly SeriesStack[]): T | undefined =>
          stacks.find((item) => item.seriesUid === seriesUid) as T | undefined;
        let stack =
          from<SeriesStack>(buildSeriesStacks(openedFilesRef.current)) ?? null;
        if (stack === null) {
          throw new Error('所选序列的数据已被关闭或清空，请重新选择');
        }

        // ── 完整来源核对与补载（本地目录重扫 / PACS 按 SeriesUID 补拉）──
        let addedCount = 0;
        let failureSuffix = '';
        const info = assessSeriesCompleteness(stack);
        const resolved = resolveRemoteContext(info, stack, pacsServers);
        if (resolved.error !== undefined) {
          throw new Error(resolved.error);
        }
        if (info.needsCheck && info.fillKind !== 'none') {
          const stageLabel =
            info.fillKind === 'directory'
              ? translate(settings.language, 'entry.fill.rescan')
              : translate(settings.language, 'entry.fill.pacs');
          setSeriesPick((prev) => ({
            ...prev,
            busy: { stageLabel, done: 0, total: 0 },
            error: null,
          }));
          const onProgress = (done: number, total: number) => {
            if (!controller.signal.aborted) {
              setSeriesPick((prev) => ({
                ...prev,
                busy: { stageLabel, done, total },
              }));
            }
          };
          let result;
          if (info.fillKind === 'directory') {
            const batch = info.batchId !== undefined ? getSourceBatch(info.batchId) : undefined;
            const handle = batch?.directoryHandle;
            if (!handle) {
              throw new Error('目录句柄不可用（可能因页面刷新失效），请重新打开该文件夹后再试');
            }
            result = await fillFromDirectory({
              directoryHandle: handle,
              targetSeriesUid: seriesUid,
              openedFileKeys: batch.openedFileKeys,
              signal: controller.signal,
              onProgress: ({ done, total }) => onProgress(done, total),
            });
          } else if (resolved.remote !== undefined) {
            const knownSopUids = new Set<string>();
            for (const file of openedFilesRef.current) {
              if (
                file.summary.seriesInstanceUid === seriesUid &&
                file.summary.sopInstanceUid
              ) {
                knownSopUids.add(file.summary.sopInstanceUid);
              }
            }
            result = await fillFromPacs({
              context: resolved.remote,
              targetSeriesUid: seriesUid,
              knownSopUids,
              signal: controller.signal,
              onProgress: ({ done, total }) => onProgress(done, total),
            });
          } else {
            result = { added: [], failures: [], checkedCount: 0, cancelled: false };
          }
          if (result.failures.length > 0) {
            failureSuffix = `；${result.failures.length} 个文件失败`;
          }
          if (result.cancelled) {
            showToast('已取消完整序列补载');
            closeSeriesPick();
            return;
          }
          if (result.added.length > 0) {
            const deduped = appendOpenedFiles(result.added);
            addedCount = deduped.kept.length;
            // 补载结果回写来源登记，后续再进重建不重复探测同一批文件
            if (info.fillKind === 'directory' && info.batchId !== undefined) {
              recordBatchOutcome(info.batchId, {
                completed: true,
                openedFiles: deduped.kept.map((file) => ({
                  fileName: file.fileName,
                  fileSizeBytes: file.fileSizeBytes,
                  seriesInstanceUid: file.summary.seriesInstanceUid,
                })),
              });
            } else if (info.fillKind === 'pacs') {
              const matched = listSourceBatches().find(
                (batch) =>
                  batch.kind === 'remote' &&
                  batch.remote?.serverName === resolved.remote?.serverName &&
                  batch.remote?.studyUid === resolved.remote?.studyUid,
              );
              if (matched) {
                recordBatchOutcome(matched.id, {
                  completed: true,
                  openedFiles: deduped.kept.map((file) => ({
                    fileName: file.fileName,
                    fileSizeBytes: file.fileSizeBytes,
                    seriesInstanceUid: file.summary.seriesInstanceUid,
                  })),
                });
              }
            }
            // 合并后重新取堆栈（React state 尚未刷新）
            stack =
              from<SeriesStack>(buildSeriesStacks(openedFilesRef.current)) ?? stack;
          }
        }

        // ── 数据门槛终检（补载后的完整集合）→ 进入对应布局 ──
        // M11 任务 2：进入尝试时重探 WebGL2（启动早期误判可在此恢复）
        const capable = reprobeWebGL2();
        const finalGate =
          target === 'mpr'
            ? checkMprEligibility(stack)
            : checkVolume3dEligibility(stack, capable);
        if (!finalGate.allowed || stack === null) {
          throw new Error(finalGate.message ?? (target === 'mpr' ? 'MPR 不可用' : '3D 不可用'));
        }
        if (target === 'mpr') {
          applyMprLayoutFor(seriesUid);
        } else {
          applyVol3dLayoutFor(seriesUid);
        }
        closeSeriesPick();
        if (addedCount > 0) {
          showToast(`已补载 ${addedCount} 个缺失实例${failureSuffix}`);
        } else if (failureSuffix !== '') {
          showToast(`部分文件核对失败${failureSuffix}`);
        }
      } catch (error) {
        console.error('[App] 完整序列补载失败', error);
        const message =
          error instanceof Error ? error.message : String(error);
        setSeriesPick((prev) => {
          if (prev.open) {
            return {
              ...prev,
              busy: null,
              error: `${translate(settings.language, 'entry.fill.failedPrefix')}${message}`,
            };
          }
          // 直接进入路径（未弹选择器）的失败：toast 明确反馈而非静默
          showToast(`打开${target === 'mpr' ? 'MPR' : '3D'}失败：${message}`);
          return prev;
        });
      } finally {
        if (seriesPickAbortRef.current === controller) {
          seriesPickAbortRef.current = null;
        }
      }
    },
    [
      appendOpenedFiles,
      applyMprLayoutFor,
      applyVol3dLayoutFor,
      closeSeriesPick,
      pacsServers,
      reprobeWebGL2,
      settings.language,
      showToast,
    ],
  );

  /** 一键「单轴向 ⇄ 三平面」（FR-6.9）+ M11 序列选择前置（多候选/未核对完整性时弹窗） */
  const beginMprEntry = useCallback(() => {
    // M11 任务 2：入口链路的任何异常都转为可见反馈，杜绝静默失败
    try {
      if (mprLayout.mode === 'on') {
        exitMprAndCapture();
        return;
      }
      const decision = decideSeriesEntry({
        stacks: seriesList,
        preferredUid: assignments[activeViewportId] ?? null,
        assess: assessForEntry,
        targetLabel: 'MPR',
      });
      if (decision.action === 'error') {
        showToast(decision.message);
        return;
      }
      if (decision.action === 'enter') {
        void confirmSeriesEntry('mpr', decision.seriesUid);
        return;
      }
      setSeriesPick({
        open: true,
        target: 'mpr',
        candidates: decision.candidates,
        busy: null,
        error: null,
      });
    } catch (error) {
      console.error('[App] 进入 MPR 失败', error);
      showToast(
        `打开MPR失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    activeViewportId,
    assignments,
    assessForEntry,
    confirmSeriesEntry,
    mprLayout.mode,
    seriesList,
    showToast,
    exitMprAndCapture,
  ]);

  /** 一键「2D ⇄ 3D 体绘制」（FR-7.1）+ M11 序列选择前置（多候选/未核对完整性时弹窗） */
  const beginVol3dEntry = useCallback(() => {
    // M11 任务 2：进入尝试先重探 WebGL2；异常转 toast 反馈
    try {
      if (vol3dLayout.mode === 'on') {
        setVol3dLayout(exitVolume3dLayout(vol3dLayout));
        return;
      }
      reprobeWebGL2();
      const decision = decideSeriesEntry({
        stacks: seriesList,
        preferredUid: assignments[activeViewportId] ?? null,
        assess: assessForEntry,
        targetLabel: '3D',
      });
      if (decision.action === 'error') {
        showToast(decision.message);
        return;
      }
      if (decision.action === 'enter') {
        void confirmSeriesEntry('vol3d', decision.seriesUid);
        return;
      }
      setSeriesPick({
        open: true,
        target: 'vol3d',
        candidates: decision.candidates,
        busy: null,
        error: null,
      });
    } catch (error) {
      console.error('[App] 进入 3D 失败', error);
      showToast(`打开3D失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [
    activeViewportId,
    assignments,
    assessForEntry,
    confirmSeriesEntry,
    reprobeWebGL2,
    seriesList,
    showToast,
    vol3dLayout,
  ]);

  // ── 测量 / 标注（FR-5.1~5.13，M10-D） ─────────────────
  /** 当前激活序列是否缺少可用像素间距（FR-5.8 触发校准入口） */
  const activeSeriesNeedsCalibration = useMemo(() => {
    const spacing = activeStack?.items[0]?.summary.pixelSpacing;
    return !hasUsablePixelSpacing(spacing);
  }, [activeStack]);

  /** 校准候选 = 全局最新可用的长度线（像素长度；激活序列缺失间距时入口才可用） */
  const calibrationCandidates = useMemo<CalibrationCandidate[]>(() => {
    const all = asAnnotationList(annotationOps.getAllAnnotations());
    const out: CalibrationCandidate[] = [];
    for (const annotation of all) {
      if ((annotation.metadata?.toolName ?? '') !== ToolNames.length) {
        continue;
      }
      const stats = firstCachedStats(annotation);
      const length = stats?.length;
      if (typeof length !== 'number' || !Number.isFinite(length) || length <= 0) {
        continue;
      }
      out.push({
        annotationUID: annotation.annotationUID ?? '',
        pixelLengthPx: length,
        seriesUid: annotationResolvers.resolveSeries(
          annotation.metadata?.referencedImageId ?? '',
        ),
      });
    }
    return out;
  }, [annotationOps, annotationResolvers]);

  /** 应用校准比例（FR-5.8）：cornerstone calibrateImageSpacing 逐 imageId 生效 */
  const applyCalibrationScale = useCallback(
    async (scaleMmPerPx: number, stack: NonNullable<typeof activeStack>) => {
      setSeriesCalibration(stack.seriesUid, scaleMmPerPx);
      try {
        const tools = await import('@cornerstonejs/tools');
        const engine = getRenderingEngine('dicom-viewer-m1-engine');
        if (!engine) {
          showToast('渲染引擎未就绪，校准失败');
          return;
        }
        const calibrate = (tools as { utilities?: { calibrateImageSpacing: (imageId: string, engine: unknown, scale: number) => void } })
          .utilities?.calibrateImageSpacing;
        if (typeof calibrate !== 'function') {
          showToast('校准能力不可用');
          return;
        }
        for (const item of stack.items) {
          calibrate(item.imageId, engine, scaleMmPerPx);
        }
        showToast(`校准成功：${formatCalibrationScale(scaleMmPerPx)}`);
        setAnnotationsVersion((version) => version + 1);
      } catch (error) {
        console.error('[App] 校准失败', error);
        showToast('校准失败，请重试');
      }
    },
    [showToast],
  );

  /** 校准弹窗提交：选中长度线 + 真实长度 → 计算比例并应用 */
  const handleCalibrationSubmit = useCallback(
    (annotationUID: string, physicalLengthMm: number) => {
      const candidate = calibrationCandidates.find((item) => item.annotationUID === annotationUID);
      if (candidate === undefined || activeStack === null) {
        showToast('校准失败：未找到对应长度测量线');
        return;
      }
      const scale = computeCalibrationScale(candidate.pixelLengthPx, physicalLengthMm);
      if (scale === null) {
        showToast('校准失败：长度或物理尺寸无效');
        return;
      }
      setShowCalibration(false);
      void applyCalibrationScale(scale, activeStack);
    },
    [activeStack, calibrationCandidates, showToast, applyCalibrationScale],
  );

  /** 面板操作：选中/跳转/显隐/删除/清空（FR-5.9） */
  const selectAnnotation = useCallback((row: AnnotationRow) => {
    setSelectedAnnotationUid(row.annotationUID);
    getAnnotationRuntime().setSelected?.(row.annotationUID, true);
    setAnnotationsVersion((version) => version + 1);
  }, []);

  const jumpToAnnotation = useCallback(
    (row: AnnotationRow) => {
      setSelectedAnnotationUid(row.annotationUID);
      getAnnotationRuntime().setSelected?.(row.annotationUID, true);
      if (row.isMpr && mprLayout.mode === 'on' && row.viewportId !== null && row.frame !== null) {
        setMprJump({
          id: Date.now(),
          viewportId: row.viewportId,
          sliceIndex: row.frame - 1,
        });
        return;
      }
      // 2D 视口跳转：切到所属视口并置帧
      const target = Object.keys(assignments).find(
        (viewportId) => assignments[viewportId] === row.seriesUid,
      );
      if (target !== undefined && row.frame !== null) {
        setActiveViewportId(target);
        apisRef.current.get(target)?.setImageIndex(row.frame - 1);
      }
    },
    [assignments, mprLayout.mode],
  );

  const toggleAnnotationVisibility = useCallback((row: AnnotationRow) => {
    getAnnotationRuntime().setVisibility?.(row.annotationUID, !row.isVisible);
    setAnnotationsVersion((version) => version + 1);
  }, []);

  const showAllAnnotations = useCallback(() => {
    getAnnotationRuntime().showAll?.();
    setAnnotationsVersion((version) => version + 1);
  }, []);

  const hideAllAnnotations = useCallback(() => {
    const all = annotationOps.getAllAnnotations();
    const rt = getAnnotationRuntime();
    for (const annotation of all) {
      const uid = annotation.annotationUID;
      if (uid !== undefined && uid !== '') {
        rt.setVisibility?.(uid, false);
      }
    }
    setAnnotationsVersion((version) => version + 1);
  }, [annotationOps]);

  const deleteAnnotation = useCallback(
    (uid: string) => {
      annotationOps.removeAnnotation(uid);
      if (selectedAnnotationUid === uid) {
        setSelectedAnnotationUid(null);
      }
      setAnnotationsVersion((version) => version + 1);
    },
    [annotationOps, selectedAnnotationUid],
  );

  const clearAnnotations = useCallback(() => {
    if (!window.confirm('确定要清空全部标注吗？')) {
      return;
    }
    const removed = clearAllAnnotations(annotationOps);
    setSelectedAnnotationUid(null);
    setAnnotationsVersion((version) => version + 1);
    showToast(removed > 0 ? `已清空 ${removed} 条标注` : '当前没有标注');
  }, [annotationOps, showToast]);

  /** 标注 JSON 导出（FR-5.11） */
  const exportAnnotationsJson = useCallback(() => {
    const all = asAnnotationList(annotationOps.getAllAnnotations());
    if (all.length === 0) {
      showToast('当前没有标注可导出');
      return;
    }
    const file = toAnnotationExportFile(all, {
      resolveSop: annotationResolvers.resolveSop,
      resolveSeries: annotationResolvers.resolveSeries,
      viewportsForSeries: annotationResolvers.viewportsForSeries,
      resolveFrameIndex: annotationResolvers.resolveFrameIndex,
      mprActive: mprLayout.mode === 'on',
    });
    const json = serializeAnnotationsJson(file);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `annotations-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${file.annotations.length} 条标注 JSON`);
  }, [annotationOps, annotationResolvers, mprLayout.mode, showToast]);

  /** 标注 JSON 导入（FR-5.11）：回填 cornerstone annotation 状态 */
  const importAnnotationsJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const imported = parseAnnotationExportFile(text);
        if (imported === null) {
          showToast('导入失败：JSON 格式无效');
          return;
        }
        const entries = imported.annotations;
        if (entries.length === 0) {
          showToast('导入文件不含标注');
          return;
        }
        const added = addImportedAnnotations(
        entries.map((entry) => entry.annotation),
        (annotation, selector) => {
          annotationOps.addAnnotation?.(annotation, selector);
        },
      );
        showToast(`已导入 ${added} 条标注`);
        setAnnotationsVersion((version) => version + 1);
      } catch (error) {
        console.error('[App] 导入标注失败', error);
        showToast('导入失败');
      }
    },
    [showToast],
  );

  /** seriesUid → 首实例 StudyInstanceUID（SR 导出引用检查级） */
  const studyUidBySeries = useMemo(() => {
    const map = new Map<string, string>();
    for (const stack of seriesList) {
      const studyUid = stack.items[0]?.summary.studyInstanceUid;
      if (typeof studyUid === 'string' && studyUid !== '') {
        map.set(stack.seriesUid, studyUid);
      }
    }
    return map;
  }, [seriesList]);

  /** DICOM SR 导出（FR-5.12） */
  const exportAnnotationsSr = useCallback(() => {
    const all = asAnnotationList(annotationOps.getAllAnnotations());
    const sr = buildMeasurementSr(all, {
      resolveSop: (imageId) => {
        const sop = annotationResolvers.resolveSop(imageId);
        if (sop === null) {
          return null;
        }
        const frame =
          frameFromImageId(imageId) ?? (annotationResolvers.resolveFrameIndex(imageId) ?? 0) + 1;
        return {
          sopClassUID:
            annotationResolvers.resolveSopClass(imageId) ?? '1.2.840.10008.5.1.4.1.1.2',
          sopInstanceUID: sop,
          frame,
        };
      },
      resolveSeries: (imageId) => {
        const series = annotationResolvers.resolveSeries(imageId);
        if (series === null) {
          return null;
        }
        return { studyInstanceUID: studyUidBySeries.get(series) ?? series, seriesInstanceUID: series };
      },
    });
    if (sr === null) {
      showToast('没有可导出的测量标注（需包含长度/角度/ROI）');
      return;
    }
    const blob = new Blob([sr], { type: 'application/dicom' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sr-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.dcm`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('已导出 DICOM SR');
  }, [annotationOps, annotationResolvers, showToast, studyUidBySeries]);

  /** 可导出的 SR 标注数（F-R5.12 面板按钮禁用态） */
  const srExportableCount = useMemo(() => {
    const all = asAnnotationList(annotationOps.getAllAnnotations());
    let count = 0;
    for (const annotation of all) {
      if (SR_TOOL_TYPE_MAP[annotation.metadata?.toolName ?? ''] !== undefined) {
        const imageId = annotation.metadata?.referencedImageId;
        if (typeof imageId === 'string' && annotationResolvers.resolveSop(imageId) !== null) {
          count += 1;
        }
      }
    }
    return count;
  }, [annotationOps, annotationResolvers]);

  // ── 全局快捷键（FR-11 子集）；文本输入框聚焦时不触发 ──
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) {
        return;
      }
      const action = resolveShortcut(event);
      if (action === null) {
        return;
      }
      event.preventDefault();
      const api = apisRef.current.get(activeViewportId) ?? null;
      switch (action.type) {
        case 'toggleInfo':
          setShowInfo((prev) => !prev);
          break;
        case 'tool':
          activateTool(ToolNames[action.tool]);
          break;
        case 'fit':
          api?.fitToWindow();
          break;
        case 'zoomIn':
          api?.zoomStep(1.25);
          break;
        case 'zoomOut':
          api?.zoomStep(0.8);
          break;
        case 'layout':
          switchLayout(action.cells);
          break;
        case 'slicePrev':
          api?.scrollSlice(-1);
          break;
        case 'sliceNext':
          api?.scrollSlice(1);
          break;
        case 'resetAll':
          api?.resetView();
          break;
        case 'cinePlaceholder':
          // FR-3.8：空格键 Cine 播放/暂停（动作名保留占位时代命名）
          toggleCine(activeViewportId);
          break;
        case 'invert':
          api?.toggleInvert();
          break;
        case 'rotateLeft':
          api?.rotateStep(90);
          break;
        case 'rotateRight':
          api?.rotateStep(-90);
          break;
        case 'crosshairPlaceholder':
          showToast('MPR 定位线将在后续里程碑提供（FR-6）');
          break;
        case 'deleteAnnotation':
          if (selectedAnnotationUid !== null) {
            deleteAnnotation(selectedAnnotationUid);
          }
          break;
        case 'cancelTool':
          setPrimaryTool(DEFAULT_PRIMARY_TOOL);
          api?.setPrimaryTool(DEFAULT_PRIMARY_TOOL);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activateTool, activeViewportId, selectedAnnotationUid, deleteAnnotation, switchLayout, toggleCine]);

  const layoutConfig = LAYOUT_CONFIG[layout];

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`app${dragActive ? ' app--drag-active' : ''}`}>
        <header className="toolbar">
          <span className="brand">DICOM 查看器 · M2</span>
          <button
            type="button"
            className="open-button"
            title={t('app.openFile')}
            aria-label={t('app.openFile')}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconFile />
            <span className="tool-button-label">{t('app.openFile')}</span>
          </button>
          <button
            type="button"
            className="open-button open-button--secondary"
            disabled={fileAccess.supportsFolder === false}
            title={
              fileAccess.supportsFolder === false
                ? '当前设备不支持打开文件夹'
                : supportsDirectoryPicker()
                  ? '递归打开整个文件夹'
                  : '递归打开整个文件夹（含子文件夹）'
            }
            onClick={() => void openFolder()}
          >
            <IconFolderOpen />
            <span className="tool-button-label">{t('app.openFolder')}</span>
          </button>
          {isMobile && patientTree.length > 0 && (
            <button
              type="button"
              className={`tool-button series-drawer-toggle${
                seriesDrawerOpen ? ' tool-button--active' : ''
              }`}
              title="序列列表（抽屉）"
              aria-haspopup="dialog"
              aria-expanded={seriesDrawerOpen}
              onClick={() => setSeriesDrawerOpen((prev) => !prev)}
            >
              <IconMenu />
              <span className="tool-button-label">☰ 序列</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="file-input"
            aria-label="选择 DICOM 文件（可多选）"
            onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              void handleFiles(files, { kind: 'file-list', label: '手动选择文件' });
              event.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="file-input"
            aria-label="选择 DICOM 文件夹（递归包含子文件夹）"
            onChange={(event) => {
              // webkitdirectory：相对路径含目录层级，但无句柄可重扫 → file-list 语义
              const files = event.target.files ? Array.from(event.target.files) : [];
              void handleFiles(files, { kind: 'file-list', label: '文件夹（无重扫句柄）' });
              event.target.value = '';
            }}
          />

          <div className="toolbar-group" role="group" aria-label="布局">
            {(Object.keys(LAYOUT_CONFIG) as LayoutKey[]).map((key) => (
              <button
                type="button"
                key={key}
                className={`tool-button${layout === key ? ' tool-button--active' : ''}`}
                title={`布局 ${key.replace('x', '×')}（快捷键 ${
                  { '1x1': '1', '1x2': '2', '2x2': '4' }[key]
                }）`}
                onClick={() => switchLayout(LAYOUT_CONFIG[key].cells)}
              >
                {LAYOUT_ICONS[key]}
                <span className="tool-button-label">{key.replace('x', '×')}</span>
              </button>
            ))}
          </div>

          <div className="toolbar-group" role="group" aria-label="工具">
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.windowLevel ? ' tool-button--active' : ''}`}
              title="窗宽窗位（中键拖动，快捷键 W）"
              onClick={() => activateTool(ToolNames.windowLevel)}
            >
              <IconWindowLevel />
              <span className="tool-button-label">窗宽窗位</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.zoom ? ' tool-button--active' : ''}`}
              title="缩放（拖动 / Ctrl+滚轮，快捷键 Z）"
              onClick={() => activateTool(ToolNames.zoom)}
            >
              <IconZoom />
              <span className="tool-button-label">缩放</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.pan ? ' tool-button--active' : ''}`}
              title="平移（左键拖动，快捷键 P）"
              onClick={() => activateTool(ToolNames.pan)}
            >
              <IconPan />
              <span className="tool-button-label">平移</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.stackScroll ? ' tool-button--active' : ''}`}
              title="层滚动（右键拖动翻层；滚轮默认翻页）"
              onClick={() => activateTool(ToolNames.stackScroll)}
            >
              <IconStackScroll />
              <span className="tool-button-label">层滚动</span>
            </button>
            {/* M11-F3 方案 a：MPR 定位线改为「可切换主工具」入口（原右键绑定让位给层滚动）。
                仅 MPR 布局显示；激活后左键拖动定位线联动三平面，再次点击回归平移。 */}
            {mprLayout.mode === 'on' && (
              <button
                type="button"
                className={`tool-button${primaryTool === MPR_CROSSHAIRS_TOOL ? ' tool-button--active' : ''}`}
                title="定位线（MPR）：激活后左键拖动移动定位线，三平面联动；再次点击回归平移"
                aria-label="定位线（MPR 左键拖动，三平面联动）"
                onClick={() => activateTool(MPR_CROSSHAIRS_TOOL)}
              >
                <IconCrosshair />
                <span className="tool-button-label">定位线</span>
              </button>
            )}
          </div>

          <div className="toolbar-group" role="group" aria-label="测量工具">
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.length ? ' tool-button--active' : ''}`}
              title="长度测量（两点连线显示物理 mm，可拖动微调；快捷键 L）"
              onClick={() => activateTool(ToolNames.length)}
            >
              <IconRuler />
              <span className="tool-button-label">长度</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.angle ? ' tool-button--active' : ''}`}
              title="角度测量（三点两线段夹角 + 两线段长度；快捷键 A）"
              onClick={() => activateTool(ToolNames.angle)}
            >
              <IconAngle />
              <span className="tool-button-label">角度</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.rectangleRoi ? ' tool-button--active' : ''}`}
              title="矩形 ROI（均值/标准差/极值/面积 mm²/像素数；快捷键 R）"
              onClick={() => activateTool(ToolNames.rectangleRoi)}
            >
              <IconRectRoi />
              <span className="tool-button-label">矩形</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.ellipticalRoi ? ' tool-button--active' : ''}`}
              title="椭圆 ROI（统计项同矩形；快捷键 O）"
              onClick={() => activateTool(ToolNames.ellipticalRoi)}
            >
              <IconEllipseRoi />
              <span className="tool-button-label">椭圆</span>
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.cobbAngle ? ' tool-button--active' : ''}`}
              title="Cobb 角测量：依次画两条线段，显示夹角与两线长度（钝角显示补角；快捷键 K）"
              onClick={() => activateTool(ToolNames.cobbAngle)}
            >
              <IconCobb />
              <span className="tool-button-label">Cobb</span>
            </button>
            {hasStack && activeSeriesNeedsCalibration && (
              <button
                type="button"
                className="tool-button tool-button--warn"
                title="像素间距缺失或为 0，无法计算物理尺寸：画长度线后手动校准"
                onClick={() => setShowCalibration(true)}
              >
                <IconCalibrate />
                <span className="tool-button-label">校准</span>
              </button>
            )}
          </div>

          {hasStack && (
            <div className="toolbar-group" aria-label="窗宽窗位">
              <select
                className="preset-select"
                value={activePresetId}
                onChange={(event) => applyPreset(event.target.value)}
                aria-label="窗宽窗位预设"
              >
                <option value="">自定义</option>
                {WW_WL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <label className="wwwl-field">
                WW
                <input
                  type="number"
                  className="wwwl-input"
                  value={wwDraft}
                  min={1}
                  step={1}
                  onChange={(event) => setWwDraft(event.target.value)}
                  onBlur={commitWwWlDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitWwWlDraft();
                    }
                  }}
                  aria-label="窗宽"
                />
              </label>
              <label className="wwwl-field">
                WL
                <input
                  type="number"
                  className="wwwl-input"
                  value={wlDraft}
                  step={1}
                  onChange={(event) => setWlDraft(event.target.value)}
                  onBlur={commitWwWlDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitWwWlDraft();
                    }
                  }}
                  aria-label="窗位"
                />
              </label>
              <button
                type="button"
                className="tool-button"
                title="恢复默认窗宽窗位"
                onClick={() => activeApi?.resetWindowLevel()}
              >
                <IconSliders />
                <span className="tool-button-label">重置窗宽窗位</span>
              </button>
            </div>
          )}

          {hasStack && (
            <div className="toolbar-group" aria-label="视图">
              <button
                type="button"
                className="tool-button"
                title="放大（+）"
                onClick={() => activeApi?.zoomStep(1.25)}
              >
                <IconZoomIn />
                <span className="tool-button-label">放大</span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="缩小（−）"
                onClick={() => activeApi?.zoomStep(0.8)}
              >
                <IconZoomOut />
                <span className="tool-button-label">缩小</span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="1:1 原始像素显示"
                onClick={() => activeApi?.oneToOne()}
              >
                <IconOneToOne />
                <span className="tool-button-label">1:1</span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="适应窗口（F / 双击视口）"
                onClick={() => activeApi?.fitToWindow()}
              >
                <IconFit />
                <span className="tool-button-label">适应窗口</span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="重置视图：窗宽窗位+缩放+平移+反色+旋转（Shift+R）"
                onClick={() => activeApi?.resetView()}
              >
                <IconReset />
                <span className="tool-button-label">重置视图</span>
              </button>
              <button
                type="button"
                className={`tool-button${activeUi.invert ? ' tool-button--active' : ''}`}
                title="反色显示（Shift+I，各视口独立）"
                onClick={() => activeApi?.toggleInvert()}
              >
                <IconInvert />
                <span className="tool-button-label">反色</span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="逆时针旋转 90°（[）"
                onClick={() => activeApi?.rotateStep(90)}
              >
                <IconRotateCcw />
                <span className="tool-button-label">逆时针</span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="顺时针旋转 90°（]）"
                onClick={() => activeApi?.rotateStep(-90)}
              >
                <IconRotateCw />
                <span className="tool-button-label">顺时针</span>
              </button>
            </div>
          )}

          {hasStack && (
            <div className="toolbar-group" aria-label="翻页">
              <button
                type="button"
                className="tool-button"
                disabled={activeUi.sliceIndex <= 0}
                onClick={() => activeApi?.scrollSlice(-1)}
                title="上一帧（PageUp / ←）"
                aria-label="上一帧"
              >
                <IconChevronLeft />
              </button>
              <span className="slice-counter">
                第 {activeUi.sliceIndex + 1} / {activeUi.sliceCount} 层
              </span>
              <button
                type="button"
                className="tool-button"
                disabled={activeUi.sliceIndex >= activeUi.sliceCount - 1}
                onClick={() => activeApi?.scrollSlice(1)}
                title="下一帧（PageDown / →）"
                aria-label="下一帧"
              >
                <IconChevronRight />
              </button>
            </div>
          )}

          {hasStack && activeUi.sliceCount > 1 && (
            <div className="toolbar-group" role="group" aria-label="Cine 播放">
              <button
                type="button"
                className={`tool-button${activeCine.playing ? ' tool-button--active' : ''}`}
                title="播放/暂停（空格键）"
                onClick={() => toggleCine(activeViewportId)}
              >
                {activeCine.playing ? <IconPause /> : <IconPlay />}
                <span className="tool-button-label">
                  {activeCine.playing ? '暂停' : '播放'}
                </span>
              </button>
              <button
                type="button"
                className="tool-button"
                title="停止并返回首帧"
                onClick={() => stopCine(activeViewportId)}
              >
                <IconStop />
                <span className="tool-button-label">停止</span>
              </button>
              <label className="cine-field">
                速度
                <input
                  type="range"
                  className="cine-speed-slider"
                  min={CINE_FPS_MIN}
                  max={CINE_FPS_MAX}
                  step={1}
                  value={activeCine.fps}
                  onChange={(event) => setCineSpeed(activeViewportId, Number(event.target.value))}
                  aria-label="Cine 播放速度（帧/秒）"
                />
                <span className="cine-fps">{activeCine.fps} fps</span>
              </label>
              <label className="cine-field cine-loop-field">
                <input
                  type="checkbox"
                  className="cine-loop-input"
                  checked={activeCine.loop}
                  onChange={(event) => setCineLoop(activeViewportId, event.target.checked)}
                />
                循环
              </label>
            </div>
          )}

          {/* M11 任务 2：禁用态的入口按钮点击不再无声——外层捕获点击并给出原因提示 */}
          <span
            className="entry-gate-wrap"
            onClick={() => {
              if (!activeMprGate.allowed && mprLayout.mode !== 'on') {
                showToast(
                  `MPR 当前不可用：${activeMprGate.message ?? '数据不满足重建要求'}`,
                );
              }
            }}
          >
            <button
              type="button"
              className={`tool-button${mprLayout.mode === 'on' ? ' tool-button--active' : ''}`}
              disabled={!activeMprGate.allowed && mprLayout.mode !== 'on'}
              title={
                mprLayout.mode === 'on'
                  ? '退出 MPR 三平面，返回 2D 布局'
                  : (activeMprGate.message ?? 'MPR 多平面重建（单轴向 ⇄ 三平面）')
              }
              onClick={beginMprEntry}
            >
              <IconMpr />
              <span className="tool-button-label">MPR</span>
            </button>
          </span>
          <span
            className="entry-gate-wrap"
            onClick={() => {
              if (!activeVol3dGate.allowed && vol3dLayout.mode !== 'on') {
                showToast(
                  `3D 当前不可用：${activeVol3dGate.message ?? 'WebGL2 或数据不满足要求'}`,
                );
              }
            }}
          >
            <button
              type="button"
              className={`tool-button${vol3dLayout.mode === 'on' ? ' tool-button--active' : ''}`}
              disabled={!activeVol3dGate.allowed && vol3dLayout.mode !== 'on'}
              title={
                vol3dLayout.mode === 'on'
                  ? '退出 3D 体绘制，返回 2D 布局'
                  : (activeVol3dGate.message ?? '3D 体绘制（vtk.js 光线投射）')
              }
              onClick={beginVol3dEntry}
            >
              <IconVolume3d />
              <span className="tool-button-label">3D</span>
            </button>
          </span>
          <button
            type="button"
            className={`tool-button${showInfo ? ' tool-button--active' : ''}`}
            title="信息覆盖文字开关（I）"
            onClick={() => setShowInfo((prev) => !prev)}
          >
            <IconInfo />
            <span className="tool-button-label">{t('app.info')}</span>
          </button>
          <button
            type="button"
            className={`tool-button${showAnnotationsPanel ? ' tool-button--active' : ''}`}
            title="标注管理（列表/跳转/显隐/删除/导入导出）"
            aria-haspopup="dialog"
            aria-expanded={showAnnotationsPanel}
            onClick={() => setShowAnnotationsPanel((prev) => !prev)}
          >
            <IconAnnotation />
            <span className="tool-button-label">标注</span>
          </button>
          <button
            type="button"
            className="tool-button"
            title="快捷键与鼠标速查表"
            aria-haspopup="dialog"
            aria-expanded={showHelp}
            onClick={() => setShowHelp(true)}
          >
            <IconHelp />
            <span className="tool-button-label">{t('app.help')}</span>
          </button>
          <button
            type="button"
            className={`tool-button${showSettings ? ' tool-button--active' : ''}`}
            title="主题 / 语言 / 缓存上限"
            aria-haspopup="dialog"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((prev) => !prev)}
          >
            <IconSettings />
            <span className="tool-button-label">{t('app.settings')}</span>
          </button>
          <button
            type="button"
            className={`tool-button${showPacs ? ' tool-button--active' : ''}`}
            title="PACS 联网（DICOMweb 配置 / 查询 / 拉取）"
            aria-haspopup="dialog"
            aria-expanded={showPacs}
            onClick={() => setShowPacs((prev) => !prev)}
          >
            <IconPacs />
            <span className="tool-button-label">PACS</span>
          </button>
        </header>

        {loadState.status === 'error' && (
          <div role="alert" className="error-banner">
            <span>无法打开文件：{loadState.message}</span>
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => setLoadState({ status: 'idle' })}
            >
              <IconClose />
              <span className="tool-button-label">关闭</span>
            </button>
          </div>
        )}
        {loadState.status !== 'error' && failures.length > 0 && (
          <ErrorReportPanel failures={failures} />
        )}

        {fileAccess.supportsFolder === false && (
          <div className="mobile-open-hint" role="note">
            {fileAccess.missingFolderHint}
          </div>
        )}

        <main className="workspace">
          {patientTree.length > 0 && !isMobile && (
            <aside className="series-panel" aria-label="序列面板">
              <SeriesPanel
                patients={patientTree}
                activeUid={assignments[activeViewportId] ?? null}
                onLoadSeries={loadSeriesToViewport}
                onCloseSeries={closeSeries}
                thumbnails={thumbnails}
              />
              <button
                type="button"
                className="tool-button clear-all-button"
                aria-label="清空全部已加载数据"
                onClick={clearAll}
              >
                <IconTrash />
                <span className="tool-button-label">清空全部</span>
              </button>
            </aside>
          )}

          <div className="viewer-grid-wrap">
            {mprStack !== null ? (
              <MprViewport
                key={mprStack.seriesUid}
                stack={mprStack}
                seriesUid={mprStack.seriesUid}
                showInfo={showInfo}
                primaryTool={primaryTool}
                jump={mprJump}
                onExitMpr={exitMprAndCapture}
              />
            ) : vol3dStack !== null ? (
              <Volume3dViewport
                key={vol3dStack.seriesUid}
                stack={vol3dStack}
                seriesUid={vol3dStack.seriesUid}
                showInfo={showInfo}
                linkedWwWl={viewportWwWl[activeViewportId]}
                onSyncWwWlTo2D={(ww, wl) =>
                  setViewportWwWl((prev) => ({
                    ...prev,
                    [activeViewportId]: { ww, wl },
                  }))
                }
                onExitVolume3d={() => setVol3dLayout((prev) => exitVolume3dLayout(prev))}
              />
            ) : (
            <div
              className="viewer-grid"
              style={{
                gridTemplateColumns: `repeat(${layoutConfig.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${Math.ceil(layoutConfig.cells / layoutConfig.columns)}, minmax(0, 1fr))`,
              }}
            >
              {ALL_VIEWPORT_IDS.slice(0, layoutConfig.cells).map((id) => {
                const stack = stackByUid.get(assignments[id] ?? '') ?? null;
                return (
                  <ViewerCell
                    key={id}
                    viewportId={id}
                    items={stack?.items ?? EMPTY_ITEMS}
                    defaultWwWl={getDefaultWwWl(stack, id)}
                    showInfo={showInfo}
                    isActive={id === activeViewportId}
                    badgeLabel={
                      stack === null
                        ? null
                        : `${stack.modality}${stack.description ? ` · ${stack.description}` : ''}`
                    }
                    onActivate={setActiveViewportId}
                    registerApi={registerApi}
                    onUiChange={handleUiChange}
                    onDropSeries={loadSeriesTo}
                    referenceCenter={
                      mprRefCenter !== null && mprRefCenter.seriesUid === assignments[id]
                        ? mprRefCenter
                        : null
                    }
                  />
                );
              })}
            </div>
            )}

            {loadState.status === 'loading' &&
              (loadState.total >= PROGRESS_BAR_MIN_FILES ? (
                <div className="load-progress" role="status" aria-live="polite">
                  <div className="load-progress-text">
                    正在解析 {loadState.done} / {loadState.total} 个文件…
                  </div>
                  <div
                    className="load-progress-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={loadState.total}
                    aria-valuenow={loadState.done}
                    aria-label="解析进度"
                  >
                    <div
                      className="load-progress-bar-fill"
                      style={{
                        width: `${Math.round((loadState.done / Math.max(1, loadState.total)) * 100)}%`,
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="tool-button"
                    aria-label="取消解析"
                    onClick={cancelLoading}
                  >
                    <IconClose />
                    <span className="tool-button-label">取消</span>
                  </button>
                </div>
              ) : (
                <div className="empty-hint">
                  正在解析 {loadState.done} / {loadState.total} 个文件…
                </div>
              ))}
            {(loadState.status === 'idle' ||
              (loadState.status === 'error' && seriesList.length === 0)) && (
              <div className="empty-hint">
                {t('app.emptyHint1')}
                <br />
                {t('app.emptyHint2')}
              </div>
            )}
            {dragActive && <div className="drop-overlay">松开以打开文件</div>}
          </div>
        </main>

        {/* 移动端序列抽屉（FR-14.2）：窄屏覆盖式左侧面板，选择序列或点遮罩关闭 */}
        {isMobile && patientTree.length > 0 && seriesDrawerOpen && (
          <>
            <div
              className="drawer-backdrop"
              aria-hidden="true"
              onClick={() => setSeriesDrawerOpen(false)}
            />
            <aside className="series-panel series-drawer" aria-label="序列面板">
              <div className="series-drawer-header">
                <span>序列</span>
                <button
                  type="button"
                  className="tool-button"
                  aria-label="关闭序列列表"
                  onClick={() => setSeriesDrawerOpen(false)}
                >
                  <IconClose />
                </button>
              </div>
              <SeriesPanel
                patients={patientTree}
                activeUid={assignments[activeViewportId] ?? null}
                onLoadSeries={(seriesUid) => {
                  loadSeriesToViewport(seriesUid);
                  setSeriesDrawerOpen(false);
                }}
                onCloseSeries={closeSeries}
                thumbnails={thumbnails}
              />
              <button
                type="button"
                className="tool-button clear-all-button"
                aria-label="清空全部已加载数据"
                onClick={clearAll}
              >
                <IconTrash />
                <span className="tool-button-label">清空全部</span>
              </button>
            </aside>
          </>
        )}

        {seriesPick.open && seriesPick.target !== null && (
          <SeriesPickerDialog
            open
            target={seriesPick.target}
            candidates={seriesPick.candidates}
            busy={seriesPick.busy}
            error={seriesPick.error}
            onConfirm={(seriesUid) => {
              void confirmSeriesEntry(seriesPick.target as SeriesPickTarget, seriesUid);
            }}
            onCancel={closeSeriesPick}
          />
        )}

        {toast !== null && (
          <div role="status" className="toast">
            {toast}
          </div>
        )}

        <HelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showPacs && (
          <PacsPanel
            servers={pacsServers}
            onServersChange={handlePacsServersChange}
            onStudiesFetched={handleRemoteStudies}
            onClose={() => setShowPacs(false)}
          />
        )}
        {showAnnotationsPanel && (
          <AnnotationsPanel
            open
            onClose={() => setShowAnnotationsPanel(false)}
            rows={annotationRows}
            selectedUid={selectedAnnotationUid}
            onSelect={selectAnnotation}
            onJump={jumpToAnnotation}
            onToggleVisibility={toggleAnnotationVisibility}
            onShowAll={showAllAnnotations}
            onHideAll={hideAllAnnotations}
            onDelete={(row) => deleteAnnotation(row.annotationUID)}
            onClear={clearAnnotations}
            onExportJson={exportAnnotationsJson}
            onImportJson={importAnnotationsJson}
            canExportSr={srExportableCount > 0}
            onExportSr={exportAnnotationsSr}
          />
        )}
        {showCalibration && (
          <CalibrationPanel
            open
            onClose={() => setShowCalibration(false)}
            candidates={calibrationCandidates}
            onSubmit={handleCalibrationSubmit}
          />
        )}

        <footer className="statusbar">
          {activeStack !== null
            ? `${activeViewportId} · ${activeStack.modality} · ${activeStack.items.length} 层 · 全部 ${totalInstances} 个实例`
            : '未加载数据'}
          {failures.length > 0 ? ` · ${failures.length} 个失败` : ''}
        </footer>
      </div>
    </I18nContext.Provider>
  );
}
