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
import { cache } from '@cornerstonejs/core';
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
import { buildSeriesTree } from '../features/series/seriesTree';
import { SeriesPanel } from '../ui/components/SeriesPanel';
import { HelpOverlay } from '../ui/components/HelpOverlay';
import { SettingsPanel } from '../ui/components/SettingsPanel';
import type { ViewportApi, ViewportUiState } from '../features/viewer/DicomViewport';
import { ViewerCell } from '../features/viewer/ViewerCell';
import { isSeriesDragEvent } from '../features/viewer/seriesDragDrop';
import { PLACEHOLDER_MEASUREMENT_TOOLS, ToolNames } from '../features/viewer/toolSetup';
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

/** 空视口共享的稳定空数组：保证 items/imageIds 引用稳定，避免 effect 反复重跑 */
const EMPTY_ITEMS: StackItem[] = [];

const EMPTY_UI: ViewportUiState = {
  sliceIndex: 0,
  sliceCount: 0,
  ww: 0,
  wl: 0,
  zoom: 1,
};

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
  /** 当前主拖动工具（null = 默认窗宽窗位） */
  const [primaryTool, setPrimaryTool] = useState<string>(ToolNames.windowLevel);
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

  const handleFiles = useCallback(
    async (inputs: readonly (ScannedFile | File)[]) => {
      if (inputs.length === 0) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setLoadState({ status: 'loading', done: 0, total: inputs.length });
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
        const deduped = dedupeBySopUid(opened, knownUidsRef.current);
        knownUidsRef.current = deduped.nextUids;
        openedFilesRef.current = [...openedFilesRef.current, ...deduped.kept];
        const stacks = buildSeriesStacks(openedFilesRef.current);
        setSeriesList(stacks);
        setFailures(failed);
        if (deduped.duplicateCount > 0) {
          showToast(`已跳过 ${deduped.duplicateCount} 个重复文件`);
        }
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
    [showToast],
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
   */
  const handleRemoteStudies = useCallback(
    (opened: OpenedDicomFile[]) => {
      if (opened.length === 0) {
        return;
      }
      const deduped = dedupeBySopUid(opened, knownUidsRef.current);
      knownUidsRef.current = deduped.nextUids;
      openedFilesRef.current = [...openedFilesRef.current, ...deduped.kept];
      const stacks = buildSeriesStacks(openedFilesRef.current);
      setSeriesList(stacks);
      if (deduped.duplicateCount > 0) {
        showToast(`已跳过 ${deduped.duplicateCount} 个重复文件`);
      }
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
    [showToast],
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
      void handleFiles(scanned);
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
          await handleFiles(result.files);
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

  /** WebGL2 能力（FR-7.1，检测一次，供 3D 门槛/入口判定） */
  const webgl2 = useMemo(() => hasWebGL2(), []);

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
      if (PLACEHOLDER_MEASUREMENT_TOOLS.includes(toolName)) {
        showToast('该测量工具在 M3 提供');
        return;
      }
      const next =
        toolName !== ToolNames.windowLevel && primaryTool === toolName
          ? ToolNames.windowLevel
          : toolName;
      setPrimaryTool(next);
      apisRef.current.get(activeViewportId)?.setPrimaryTool(next);
    },
    [activeViewportId, primaryTool, showToast],
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

  /** 关闭单个序列：清空引用它的视口 + 释放图像缓存与内存缓冲（FR-2.9） */
  const closeSeries = useCallback(
    (seriesUid: string) => {
      const stack = stackByUid.get(seriesUid);
      if (!stack) {
        return;
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
    [mprLayout, showToast, stackByUid, vol3dLayout],
  );

  /** 清空全部数据集（FR-2.9）：二次确认后释放所有缓存与注册表 */
  const clearAll = useCallback(() => {
    if (!window.confirm('确定要清空所有已加载的数据吗？将释放全部图像缓存与内存。')) {
      return;
    }
    setAssignments(Object.fromEntries(ALL_VIEWPORT_IDS.map((id) => [id, null])));
    if (mprLayout.mode === 'on') {
      setMprLayout(exitMprLayout(mprLayout));
    }
    if (vol3dLayout.mode === 'on') {
      setVol3dLayout(exitVolume3dLayout(vol3dLayout));
    }
    openedFilesRef.current = [];
    knownUidsRef.current = new Set();
    setSeriesList([]);
    setFailures([]);
    setUiMap({});
    setThumbnails({});
    setLoadState({ status: 'idle' });
    void releaseAll(seriesList).then(() => showToast('已清空全部数据'));
  }, [mprLayout, seriesList, showToast, vol3dLayout]);

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
    setLayout(key);
    setActiveViewportId((prev) =>
      ALL_VIEWPORT_IDS.slice(0, cells).includes(prev as (typeof ALL_VIEWPORT_IDS)[number])
        ? prev
        : 'vp-0',
    );
  }, []);

  /** 一键「单轴向 ⇄ 三平面」（FR-6.9）：进入时锁定量激活序列并快照 2D 布局 */
  const toggleMpr = useCallback(() => {
    if (mprLayout.mode === 'on') {
      setMprLayout(exitMprLayout(mprLayout));
      return;
    }
    const stack = stackByUid.get(assignments[activeViewportId] ?? '') ?? null;
    const gate = checkMprEligibility(stack);
    if (!gate.allowed) {
      showToast(gate.message ?? 'MPR 不可用');
      return;
    }
    if (stack === null) {
      return;
    }
    // 进入 MPR 时退出 3D（两种模式互斥，共用同一渲染引擎）
    if (vol3dLayout.mode === 'on') {
      setVol3dLayout(exitVolume3dLayout(vol3dLayout));
    }
    setMprLayout(
      enterMprLayout(mprLayout, stack.seriesUid, LAYOUT_CONFIG[layout].cells),
    );
  }, [mprLayout, stackByUid, assignments, activeViewportId, layout, showToast, vol3dLayout]);

  /** 一键「2D ⇄ 3D 体绘制」（FR-7.1）：进入时锁定量激活序列并快照 2D 布局 */
  const toggleVol3d = useCallback(() => {
    if (vol3dLayout.mode === 'on') {
      setVol3dLayout(exitVolume3dLayout(vol3dLayout));
      return;
    }
    const stack = stackByUid.get(assignments[activeViewportId] ?? '') ?? null;
    const gate = checkVolume3dEligibility(stack, webgl2);
    if (!gate.allowed) {
      showToast(gate.message ?? '3D 不可用');
      return;
    }
    if (stack === null) {
      return;
    }
    // 进入 3D 时退出 MPR（两种模式互斥，共用同一渲染引擎）
    if (mprLayout.mode === 'on') {
      setMprLayout(exitMprLayout(mprLayout));
    }
    setVol3dLayout(
      enterVolume3dLayout(vol3dLayout, stack.seriesUid, LAYOUT_CONFIG[layout].cells),
    );
  }, [vol3dLayout, stackByUid, assignments, activeViewportId, layout, showToast, webgl2, mprLayout]);

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
        case 'placeholderMeasurement':
          showToast('该测量工具在 M3 提供');
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
          showToast('Cine 播放将在后续里程碑提供（FR-3.8）');
          break;
        case 'crosshairPlaceholder':
          showToast('MPR 定位线将在后续里程碑提供（FR-6）');
          break;
        case 'deleteAnnotationPlaceholder':
          showToast('标注删除将在 M3 提供（FR-5.9）');
          break;
        case 'cancelTool':
          setPrimaryTool(ToolNames.windowLevel);
          api?.setPrimaryTool(ToolNames.windowLevel);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activateTool, activeViewportId, showToast, switchLayout]);

  const layoutConfig = LAYOUT_CONFIG[layout];

  return (
    <I18nContext.Provider value={i18n}>
      <div className={`app${dragActive ? ' app--drag-active' : ''}`}>
        <header className="toolbar">
          <span className="brand">DICOM 查看器 · M2</span>
          <button
            type="button"
            className="open-button"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('app.openFile')}
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
            {t('app.openFolder')}
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
              ☰ 序列
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
              void handleFiles(files);
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
              const files = event.target.files ? Array.from(event.target.files) : [];
              void handleFiles(files);
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
                {key.replace('x', '×')}
              </button>
            ))}
          </div>

          <div className="toolbar-group" role="group" aria-label="工具">
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.windowLevel ? ' tool-button--active' : ''}`}
              title="窗宽窗位（左键拖动，快捷键 W）"
              onClick={() => activateTool(ToolNames.windowLevel)}
            >
              窗宽窗位
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.zoom ? ' tool-button--active' : ''}`}
              title="缩放（拖动 / Ctrl+滚轮，快捷键 Z）"
              onClick={() => activateTool(ToolNames.zoom)}
            >
              缩放
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.pan ? ' tool-button--active' : ''}`}
              title="平移（中键拖动，快捷键 P）"
              onClick={() => activateTool(ToolNames.pan)}
            >
              平移
            </button>
            <button
              type="button"
              className={`tool-button${primaryTool === ToolNames.stackScroll ? ' tool-button--active' : ''}`}
              title="层滚动（激活后拖动翻层；滚轮默认翻页）"
              onClick={() => activateTool(ToolNames.stackScroll)}
            >
              层滚动
            </button>
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
                重置窗宽窗位
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
                ＋
              </button>
              <button
                type="button"
                className="tool-button"
                title="缩小（−）"
                onClick={() => activeApi?.zoomStep(0.8)}
              >
                －
              </button>
              <button
                type="button"
                className="tool-button"
                title="1:1 原始像素显示"
                onClick={() => activeApi?.oneToOne()}
              >
                1:1
              </button>
              <button
                type="button"
                className="tool-button"
                title="适应窗口（F / 双击视口）"
                onClick={() => activeApi?.fitToWindow()}
              >
                适应窗口
              </button>
              <button
                type="button"
                className="tool-button"
                title="重置视图：窗宽窗位+缩放+平移（Shift+R）"
                onClick={() => activeApi?.resetView()}
              >
                重置视图
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
              >
                ◀
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
              >
                ▶
              </button>
            </div>
          )}

          <button
            type="button"
            className={`tool-button${mprLayout.mode === 'on' ? ' tool-button--active' : ''}`}
            disabled={!activeMprGate.allowed && mprLayout.mode !== 'on'}
            title={
              mprLayout.mode === 'on'
                ? '退出 MPR 三平面，返回 2D 布局'
                : (activeMprGate.message ?? 'MPR 多平面重建（单轴向 ⇄ 三平面）')
            }
            onClick={toggleMpr}
          >
            MPR
          </button>
          <button
            type="button"
            className={`tool-button${vol3dLayout.mode === 'on' ? ' tool-button--active' : ''}`}
            disabled={!activeVol3dGate.allowed && vol3dLayout.mode !== 'on'}
            title={
              vol3dLayout.mode === 'on'
                ? '退出 3D 体绘制，返回 2D 布局'
                : (activeVol3dGate.message ?? '3D 体绘制（vtk.js 光线投射）')
            }
            onClick={toggleVol3d}
          >
            3D
          </button>
          <button
            type="button"
            className={`tool-button${showInfo ? ' tool-button--active' : ''}`}
            title="信息覆盖文字开关（I）"
            onClick={() => setShowInfo((prev) => !prev)}
          >
            {t('app.info')}
          </button>
          <button
            type="button"
            className="tool-button"
            title="快捷键速查表"
            aria-haspopup="dialog"
            aria-expanded={showHelp}
            onClick={() => setShowHelp(true)}
          >
            {t('app.help')}
          </button>
          <button
            type="button"
            className={`tool-button${showSettings ? ' tool-button--active' : ''}`}
            title="主题 / 语言 / 缓存上限"
            aria-haspopup="dialog"
            aria-expanded={showSettings}
            onClick={() => setShowSettings((prev) => !prev)}
          >
            {t('app.settings')}
          </button>
          <button
            type="button"
            className={`tool-button${showPacs ? ' tool-button--active' : ''}`}
            title="PACS 联网（DICOMweb 配置 / 查询 / 拉取）"
            aria-haspopup="dialog"
            aria-expanded={showPacs}
            onClick={() => setShowPacs((prev) => !prev)}
          >
            PACS
          </button>
        </header>

        {loadState.status === 'error' && (
          <div role="alert" className="error-banner">
            <span>无法打开文件：{loadState.message}</span>
            <button type="button" onClick={() => setLoadState({ status: 'idle' })}>
              关闭
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
              <button type="button" className="tool-button clear-all-button" onClick={clearAll}>
                清空全部
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
                onExitMpr={() => setMprLayout((prev) => exitMprLayout(prev))}
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
                  <button type="button" className="tool-button" onClick={cancelLoading}>
                    取消
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
                  ×
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
              <button type="button" className="tool-button clear-all-button" onClick={clearAll}>
                清空全部
              </button>
            </aside>
          </>
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
