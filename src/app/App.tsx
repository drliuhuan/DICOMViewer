/**
 * 应用壳：工具栏、全窗口拖拽、错误提示、视口与序列面板。
 * 工具/视图操作通过 DicomViewport 上报的命令式 API 驱动。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  openDicomFiles,
  type LoadFailure,
} from '../features/loading/openDicomFiles';
import { buildSeriesStacks, type SeriesStack } from '../features/series/buildStacks';
import {
  DicomViewport,
  STACK_VIEWPORT_ID,
  type ViewportApi,
  type ViewportUiState,
} from '../features/viewer/DicomViewport';
import { PLACEHOLDER_MEASUREMENT_TOOLS, ToolNames } from '../features/viewer/toolSetup';
import {
  WW_WL_PRESETS,
  findPresetById,
  getDefaultWwWlForModality,
} from '../features/viewer/wwPresets';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; count: number }
  | { status: 'loaded' }
  | { status: 'error'; message: string };

const EMPTY_UI: ViewportUiState = { sliceIndex: 0, sliceCount: 0, ww: 0, wl: 0 };

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const [seriesList, setSeriesList] = useState<SeriesStack[]>([]);
  const [failures, setFailures] = useState<LoadFailure[]>([]);
  const [activeSeriesUid, setActiveSeriesUid] = useState<string | null>(null);
  /** 当前主拖动工具（null = 默认窗宽窗位） */
  const [primaryTool, setPrimaryTool] = useState<string | null>(ToolNames.windowLevel);
  const [ui, setUi] = useState<ViewportUiState>(EMPTY_UI);
  /** WW/WL 输入框草稿（允许清空/中间态，失焦或回车时提交） */
  const [wwDraft, setWwDraft] = useState('');
  const [wlDraft, setWlDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const apiRef = useRef<ViewportApi | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

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
          message:
            failed[0]?.message ?? '没有可显示的 DICOM 文件',
        });
        return;
      }
      setActiveSeriesUid(stacks[0]?.seriesUid ?? null);
      setLoadState({ status: 'loaded' });
    } catch (error) {
      console.error('[App] 打开文件失败', error);
      setLoadState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  // 全窗口拖拽入口（FR-1.1）
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
    };
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
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
      void handleFiles(Array.from(event.dataTransfer?.files ?? []));
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
  }, [handleFiles]);

  const activeStack = useMemo(
    () => seriesList.find((series) => series.seriesUid === activeSeriesUid) ?? null,
    [seriesList, activeSeriesUid],
  );
  const activeImageIds = useMemo(
    () => activeStack?.items.map((item) => item.imageId) ?? [],
    [activeStack],
  );

  /** 激活主拖动工具；测量类工具为 M3 占位 */
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
      apiRef.current?.setPrimaryTool(next);
    },
    [primaryTool, showToast],
  );

  const scrollSlice = useCallback((delta: number) => {
    apiRef.current?.scrollSlice(delta);
  }, []);

  // 视口 WW/WL 变化（拖动/预设/重置）→ 同步输入框草稿与预设选中态
  useEffect(() => {
    setWwDraft(String(ui.ww));
    setWlDraft(String(ui.wl));
  }, [ui.ww, ui.wl]);

  const activePresetId = useMemo(
    () =>
      WW_WL_PRESETS.find((p) => p.ww === ui.ww && p.wl === ui.wl)?.id ?? '',
    [ui.ww, ui.wl],
  );

  /** 提交输入框草稿为窗宽窗位；非法值回退到当前生效值 */
  const commitWwWlDraft = useCallback(() => {
    const ww = Number(wwDraft);
    const wl = Number(wlDraft);
    if (Number.isFinite(ww) && ww > 0 && Number.isFinite(wl)) {
      apiRef.current?.applyWwWl(ww, wl);
    } else {
      setWwDraft(String(ui.ww));
      setWlDraft(String(ui.wl));
    }
  }, [wwDraft, wlDraft, ui.ww, ui.wl]);

  const applyPreset = useCallback((presetId: string) => {
    const preset = findPresetById(presetId);
    if (preset) {
      apiRef.current?.applyWwWl(preset.ww, preset.wl);
    }
  }, []);

  /** 当前堆栈的默认窗宽窗位（文件自带优先，其次模态预设） */
  const defaultWwWl = useMemo(() => {
    if (activeStack === null) {
      return undefined;
    }
    const summary = activeStack.items[0]?.summary;
    return getDefaultWwWlForModality(summary?.modality ?? '', {
      windowWidth: summary?.windowWidth,
      windowCenter: summary?.windowCenter,
    });
  }, [activeStack]);

  const totalFiles = seriesList.reduce((sum, s) => sum + s.items.length, 0);
  const hasStack = ui.sliceCount > 0;

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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="file-input"
          aria-label="选择 DICOM 文件（可多选）"
          onChange={(event) => {
            const files = event.target.files
              ? Array.from(event.target.files)
              : [];
            void handleFiles(files);
            event.target.value = '';
          }}
        />

        <div className="toolbar-group" role="group" aria-label="工具">
          <button
            type="button"
            className={`tool-button${primaryTool === ToolNames.windowLevel ? ' tool-button--active' : ''}`}
            title="窗宽窗位（左键拖动）"
            onClick={() => activateTool(ToolNames.windowLevel)}
          >
            窗宽窗位
          </button>
          <button
            type="button"
            className={`tool-button${primaryTool === ToolNames.zoom ? ' tool-button--active' : ''}`}
            title="缩放（拖动 / Ctrl+滚轮）"
            onClick={() => activateTool(ToolNames.zoom)}
          >
            缩放
          </button>
          <button
            type="button"
            className={`tool-button${primaryTool === ToolNames.pan ? ' tool-button--active' : ''}`}
            title="平移（中键拖动）"
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
              onClick={() =>
                defaultWwWl !== undefined &&
                apiRef.current?.applyWwWl(defaultWwWl.ww, defaultWwWl.wl)
              }
            >
              重置窗宽窗位
            </button>
          </div>
        )}

        {hasStack && (
          <div className="toolbar-group" aria-label="翻页">
            <button
              type="button"
              className="tool-button"
              disabled={ui.sliceIndex <= 0}
              onClick={() => scrollSlice(-1)}
              title="上一帧（PageUp / ←）"
            >
              ◀
            </button>
            <span className="slice-counter">
              第 {ui.sliceIndex + 1} / {ui.sliceCount} 层
            </span>
            <button
              type="button"
              className="tool-button"
              disabled={ui.sliceIndex >= ui.sliceCount - 1}
              onClick={() => scrollSlice(1)}
              title="下一帧（PageDown / →）"
            >
              ▶
            </button>
          </div>
        )}

        <span className="toolbar-hint">
          多选/拖拽打开 · 滚轮翻页 · Ctrl+滚轮缩放 · 中键平移
        </span>
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
                  series.seriesUid === activeSeriesUid ? ' series-item--active' : ''
                }`}
                onClick={() => setActiveSeriesUid(series.seriesUid)}
              >
                <span className="series-item-modality">{series.modality}</span>
                <span className="series-item-label">
                  序列 {index + 1}
                  {series.description !== undefined
                    ? ` · ${series.description}`
                    : ''}
                </span>
                <span className="series-item-count">{series.items.length} 层</span>
              </button>
            ))}
          </aside>
        )}

        <div className="viewport-area">
          {(activeImageIds.length > 0 || loadState.status === 'loading') && (
            <>
              <DicomViewport
                imageIds={activeImageIds}
                defaultWwWl={defaultWwWl}
                onApiReady={(api) => {
                  apiRef.current = api;
                }}
                onUiChange={setUi}
              />
            </>
          )}
          {loadState.status === 'loading' && (
            <div className="empty-hint">正在解析 {loadState.count} 个文件…</div>
          )}
          {(loadState.status === 'idle' ||
            (loadState.status === 'error' && seriesList.length === 0)) && (
            <div className="empty-hint">
              将 DICOM 文件拖拽到窗口任意位置，
              <br />
              或点击上方「打开文件」按钮（可多选）
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
          ? `${STACK_VIEWPORT_ID} · 共 ${totalFiles} 个实例 · ${activeStack.modality}`
          : '未加载数据'}
        {failures.length > 0 ? ` · ${failures.length} 个失败` : ''}
      </footer>
    </div>
  );
}
