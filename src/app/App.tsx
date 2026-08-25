/**
 * 应用壳：工具栏（打开文件）、全窗口拖拽、错误提示、视口、序列面板与信息覆盖。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  openDicomFiles,
  type LoadFailure,
} from '../features/loading/openDicomFiles';
import { buildSeriesStacks, type SeriesStack } from '../features/series/buildStacks';
import { DicomViewport, STACK_VIEWPORT_ID } from '../features/viewer/DicomViewport';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; count: number }
  | { status: 'loaded' }
  | { status: 'error'; message: string };

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const [seriesList, setSeriesList] = useState<SeriesStack[]>([]);
  const [failures, setFailures] = useState<LoadFailure[]>([]);
  /** 当前加载到唯一视口的堆栈（M1 布局提交前为固定视口） */
  const [activeSeriesUid, setActiveSeriesUid] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
            failed.length > 0
              ? failed[0]?.message ?? '没有可显示的 DICOM 文件'
              : '没有可显示的 DICOM 文件',
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
  const activeSummary =
    activeStack !== null ? (activeStack.items[0]?.summary ?? null) : null;

  const totalFiles = seriesList.reduce((sum, s) => sum + s.items.length, 0);

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
        <span className="toolbar-hint">
          支持多选/拖拽多个 DICOM 文件，滚轮翻页
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
      {!(
        loadState.status === 'error' && failures.length > 0
      ) &&
        failures.length > 0 && (
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
          {(activeStack !== null || loadState.status === 'loading') && (
            <>
              <DicomViewport imageIds={activeImageIds} />
              {activeSummary !== null && activeStack !== null && (
                <div className="info-overlay">
                  <div>PatientName: {activeSummary.patientName}</div>
                  <div>Modality: {activeSummary.modality}</div>
                  <div>
                    Rows×Cols: {activeSummary.rows}×{activeSummary.columns} ·{' '}
                    {activeStack.items.length} 帧
                  </div>
                </div>
              )}
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

      <footer className="statusbar">
        {activeStack !== null
          ? `${STACK_VIEWPORT_ID} · 共 ${totalFiles} 个实例 · ${activeStack.modality}`
          : '未加载数据'}
        {failures.length > 0 ? ` · ${failures.length} 个失败` : ''}
      </footer>
    </div>
  );
}
