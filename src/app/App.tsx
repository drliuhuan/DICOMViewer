/**
 * 应用壳：工具栏（打开文件）、全窗口拖拽、错误提示、视口与信息覆盖。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openDicomFile, type OpenedDicomFile } from '../features/loading/openDicomFile';
import { DicomViewport } from '../features/viewer/DicomViewport';
import { InfoOverlay } from '../ui/components/InfoOverlay';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; fileName: string }
  | { status: 'loaded'; file: OpenedDicomFile }
  | { status: 'error'; message: string };

export default function App() {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) {
      return;
    }
    setLoadState({ status: 'loading', fileName: file.name });
    try {
      const opened = await openDicomFile(file);
      setLoadState({ status: 'loaded', file: opened });
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

  const loadedFile = loadState.status === 'loaded' ? loadState.file : null;

  return (
    <div className={`app${dragActive ? ' app--drag-active' : ''}`}>
      <header className="toolbar">
        <span className="brand">DICOM 查看器 · M0</span>
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
          className="file-input"
          aria-label="选择 DICOM 文件"
          onChange={(event) => {
            const files = event.target.files
              ? Array.from(event.target.files)
              : [];
            void handleFiles(files);
            event.target.value = '';
          }}
        />
        <span className="toolbar-hint">或将 DICOM 文件拖拽到窗口任意位置</span>
      </header>

      {loadState.status === 'error' && (
        <div role="alert" className="error-banner">
          <span>无法打开文件：{loadState.message}</span>
          <button type="button" onClick={() => setLoadState({ status: 'idle' })}>
            关闭
          </button>
        </div>
      )}

      <main className="viewport-area">
        {loadedFile !== null && (
          <>
            <DicomViewport imageId={loadedFile.imageId} />
            <InfoOverlay summary={loadedFile.summary} />
          </>
        )}
        {loadState.status === 'loading' && (
          <div className="empty-hint">
            正在解析「{loadState.fileName}」…
          </div>
        )}
        {(loadState.status === 'idle' || loadState.status === 'error') && (
          <div className="empty-hint">
            将 DICOM 文件拖拽到窗口任意位置，
            <br />
            或点击上方「打开文件」按钮
          </div>
        )}
        {dragActive && <div className="drop-overlay">松开以打开文件</div>}
      </main>

      <footer className="statusbar">
        {loadedFile !== null
          ? `${loadedFile.fileName} · ${(loadedFile.fileSizeBytes / 1024).toFixed(1)} KB · ${loadedFile.summary.sopInstanceUid ?? ''}`
          : '未加载数据'}
      </footer>
    </div>
  );
}
