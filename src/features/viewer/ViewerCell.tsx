/**
 * 视口网格单元格：固定 viewportId 的 DicomViewport 封装。
 *
 * 将 viewportId 与回调绑定，使父组件可以稳定地按视口收集
 * 命令式 API（registerApi）与 UI 状态（onUiChange），
 * 并处理激活态高亮、点击激活与序列拖拽放置目标。
 */
import { useCallback, useState } from 'react';
import { DicomViewport } from './DicomViewport';
import type { MprReferenceCenter, ViewportApi, ViewportUiState } from './DicomViewport';
import { isSeriesDragEvent, readSeriesUidFromDataTransfer } from './seriesDragDrop';
import type { StackItem } from '../series/buildStacks';

interface ViewerCellProps {
  viewportId: string;
  items: StackItem[];
  defaultWwWl?: { ww: number; wl: number };
  showInfo: boolean;
  isActive: boolean;
  /** 视口左上角显示的已加载序列名（FR-2.8 AC-22）；null = 未加载 */
  badgeLabel: string | null;
  /** 点击/按下时激活该视口 */
  onActivate: (viewportId: string) => void;
  registerApi: (viewportId: string, api: ViewportApi | null) => void;
  onUiChange: (viewportId: string, ui: ViewportUiState) => void;
  /** 序列卡片拖放到本视口时回调（携带 seriesUid） */
  onDropSeries?: (viewportId: string, seriesUid: string) => void;
  /** MPR 参考线中心（FR-6.10）：仅与当前序列匹配时传递 */
  referenceCenter?: MprReferenceCenter | null;
}

export function ViewerCell({
  viewportId,
  items,
  defaultWwWl,
  showInfo,
  isActive,
  badgeLabel,
  onActivate,
  registerApi,
  onUiChange,
  onDropSeries,
  referenceCenter = null,
}: ViewerCellProps) {
  const [isSeriesDropTarget, setIsSeriesDropTarget] = useState(false);

  // 以下回调依赖均为本单元格常量，identity 稳定
  const handleApiReady = useCallback(
    (api: ViewportApi) => {
      registerApi(viewportId, api);
    },
    [registerApi, viewportId],
  );
  const handleUiChange = useCallback(
    (ui: ViewportUiState) => {
      onUiChange(viewportId, ui);
    },
    [onUiChange, viewportId],
  );
  const handleActivate = useCallback(() => {
    onActivate(viewportId);
  }, [onActivate, viewportId]);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!onDropSeries || !isSeriesDragEvent(event.nativeEvent)) {
        return;
      }
      // preventDefault 才允许成为放置目标
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsSeriesDropTarget(true);
    },
    [onDropSeries],
  );
  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!isSeriesDragEvent(event.nativeEvent)) {
      return;
    }
    setIsSeriesDropTarget(false);
  }, []);
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const seriesUid = readSeriesUidFromDataTransfer(event.nativeEvent.dataTransfer);
      if (!onDropSeries || seriesUid === null) {
        return;
      }
      event.preventDefault();
      // 阻止冒泡到 window 级 drop（避免误触发外部文件打开逻辑）
      event.stopPropagation();
      setIsSeriesDropTarget(false);
      onDropSeries(viewportId, seriesUid);
    },
    [onDropSeries, viewportId],
  );

  return (
    <div
      className={`viewport-cell${isActive ? ' viewport-cell--active' : ''}${
        isSeriesDropTarget ? ' viewport-cell--drop-target' : ''
      }`}
      onMouseDown={handleActivate}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <DicomViewport
        viewportId={viewportId}
        items={items}
        defaultWwWl={defaultWwWl}
        showInfo={showInfo}
        onApiReady={handleApiReady}
        onUiChange={handleUiChange}
        referenceCenter={referenceCenter}
      />
      {badgeLabel !== null && <div className="viewport-badge">{badgeLabel}</div>}
    </div>
  );
}
