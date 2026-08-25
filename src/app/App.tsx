/**
 * 应用壳：工具栏、全局快捷键、序列面板、多视口布局（FR-3.12 最小集）。
 *
 * - 布局：1×1 / 1×2 / 2×2（按钮 + 快捷键 1/2/4），各视口独立加载序列；
 * - 激活视口：点击视口切换；工具栏与快捷键作用于激活视口；
 * - 序列面板：点击序列加载到当前激活视口；拖拽序列卡片到指定视口放置加载
 *   （FR-2.8 单击语义 + 拖拽扩展）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  openDicomFiles,
  type LoadFailure,
} from '../features/loading/openDicomFiles';
import {
  scanDroppedItems,
  scanDirectoryHandle,
  supportsDirectoryPicker,
  type DirectoryHandleLike,
} from '../features/loading/directoryScan';
import { buildSeriesStacks, type SeriesStack, type StackItem } from '../features/series/buildStacks';
import type { ViewportApi, ViewportUiState } from '../features/viewer/DicomViewport';
import { ViewerCell } from '../features/viewer/ViewerCell';
import { SERIES_UID_MIME, isSeriesDragEvent } from '../features/viewer/seriesDragDrop';
import {
  PLACEHOLDER_MEASUREMENT_TOOLS,
  ToolNames,
} from '../features/viewer/toolSetup';
import {
  WW_WL_PRESETS,
  findPresetById,
  getDefaultWwWlForModality,
} from '../features/viewer/wwPresets';
import {
  isTextInputTarget,
  resolveShortcut,
} from '../features/shortcuts/shortcuts';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; count: number }
  | { status: 'loaded' }
  | { status: 'error'; message: string };

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
  /** 当前主拖动工具（null = 默认窗宽窗位） */
  const [primaryTool, setPrimaryTool] = useState<string>(ToolNames.windowLevel);
  const [showInfo, setShowInfo] = useState(true);
  const [uiMap, setUiMap] = useState<Record<string, ViewportUiState>>({});
  /** WW/WL 输入框草稿（允许清空/中间态，失焦或回车时提交） */
  const [wwDraft, setWwDraft] = useState('');
  const [wlDraft, setWlDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);

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
  }, []);

  const activeApi = apisRef.current.get(activeViewportId) ?? null;
  const activeUi = uiMap[activeViewportId] ?? EMPTY_UI;
  const hasStack = activeUi.sliceCount > 0;

  // ── 文件打开 ────────────────────────────────────────
  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setLoadState({ status: 'loading', count: files.length });
    try {
      const { opened, failures: failed } = await openDicomFiles(files);
      const stacks = buildSeriesStacks(opened);
      setSeriesList(stacks);
      setFailures(failed);
      if (stacks.length === 0) {
        setLoadState({
          status: 'error',
          message: failed[0]?.message ?? '没有可显示的 DICOM 文件',
        });
        return;
      }
      const firstUid = stacks[0]?.seriesUid ?? null;
      setAssignments(
        Object.fromEntries(ALL_VIEWPORT_IDS.map((id) => [id, id === 'vp-0' ? firstUid : null])),
      );
      setActiveViewportId('vp-0');
      setLoadState({ status: 'loaded' });
    } catch (error) {
      console.error('[App] 打开文件失败', error);
      setLoadState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

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
      void handleFiles(scanned.map((item) => item.file));
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
          await handleFiles(result.files.map((item) => item.file));
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

  /** 指定堆栈的默认窗宽窗位（文件自带优先，其次模态预设） */
  const getDefaultWwWl = useCallback(
    (stack: SeriesStack | null) => {
      if (stack === null) {
        return undefined;
      }
      const summary = stack.items[0]?.summary;
      return getDefaultWwWlForModality(summary?.modality ?? '', {
        windowWidth: summary?.windowWidth,
        windowCenter: summary?.windowCenter,
      });
    },
    [],
  );

  const totalInstances = seriesList.reduce((sum, s) => sum + s.items.length, 0);

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
    <div className={`app${dragActive ? ' app--drag-active' : ''}`}>
      <header className="toolbar">
        <span className="brand">DICOM 查看器 · M1</span>
        <button
          type="button"
          className="open-button"
          onClick={() => fileInputRef.current?.click()}
        >
          打开文件
        </button>
        <button
          type="button"
          className="open-button open-button--secondary"
          title={supportsDirectoryPicker() ? '递归打开整个文件夹' : '递归打开整个文件夹（含子文件夹）'}
          onClick={() => void openFolder()}
        >
          打开文件夹
        </button>
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
          className={`tool-button${showInfo ? ' tool-button--active' : ''}`}
          title="信息覆盖文字开关（I）"
          onClick={() => setShowInfo((prev) => !prev)}
        >
          信息
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
        <div className="warn-banner">
          {failures.length} 个文件解析失败已跳过：
          {failures
            .slice(0, 3)
            .map((f) => f.fileName)
            .join('、')}
          {failures.length > 3 ? ' …' : ''}
        </div>
      )}

      <main className="workspace">
        {seriesList.length > 0 && (
          <aside className="series-panel">
            <div className="series-panel-title">序列（{seriesList.length}）</div>
            {seriesList.map((series, index) => (
              <button
                type="button"
                key={series.seriesUid}
                className={`series-item${
                  series.seriesUid === assignments[activeViewportId]
                    ? ' series-item--active'
                    : ''
                }`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(SERIES_UID_MIME, series.seriesUid);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => loadSeriesToViewport(series.seriesUid)}
                title="点击加载到当前激活视口；拖拽到指定视口放置加载"
              >
                <span className="series-item-modality">{series.modality}</span>
                <span className="series-item-label">
                  序列 {index + 1}
                  {series.description !== undefined ? ` · ${series.description}` : ''}
                </span>
                <span className="series-item-count">{series.items.length} 层</span>
              </button>
            ))}
          </aside>
        )}

        <div className="viewer-grid-wrap">
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
                  defaultWwWl={getDefaultWwWl(stack)}
                  showInfo={showInfo}
                  isActive={id === activeViewportId}
                  onActivate={setActiveViewportId}
                  registerApi={registerApi}
                  onUiChange={handleUiChange}
                  onDropSeries={loadSeriesTo}
                />
              );
            })}
          </div>

          {loadState.status === 'loading' && (
            <div className="empty-hint">正在解析 {loadState.count} 个文件…</div>
          )}
          {(loadState.status === 'idle' ||
            (loadState.status === 'error' && seriesList.length === 0)) && (
            <div className="empty-hint">
              将 DICOM 文件或整个文件夹拖拽到窗口任意位置，
              <br />
              或点击上方「打开文件 / 打开文件夹」按钮
            </div>
          )}
          {dragActive && <div className="drop-overlay">松开以打开文件</div>}
        </div>
      </main>

      {toast !== null && (
        <div role="status" className="toast">
          {toast}
        </div>
      )}

      <footer className="statusbar">
        {activeStack !== null
          ? `${activeViewportId} · ${activeStack.modality} · ${activeStack.items.length} 层 · 全部 ${totalInstances} 个实例`
          : '未加载数据'}
        {failures.length > 0 ? ` · ${failures.length} 个失败` : ''}
      </footer>
    </div>
  );
}
