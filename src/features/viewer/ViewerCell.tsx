/**
 * 视口网格单元格：固定 viewportId 的 DicomViewport 封装。
 *
 * 将 viewportId 与回调绑定，使父组件可以稳定地按视口收集
 * 命令式 API（registerApi）与 UI 状态（onUiChange），
 * 并处理激活态高亮与点击激活。
 */
import { useCallback } from 'react';
import { DicomViewport } from './DicomViewport';
import type { ViewportApi, ViewportUiState } from './DicomViewport';
import type { StackItem } from '../series/buildStacks';

interface ViewerCellProps {
  viewportId: string;
  items: StackItem[];
  defaultWwWl?: { ww: number; wl: number };
  showInfo: boolean;
  isActive: boolean;
  /** 点击/按下时激活该视口 */
  onActivate: (viewportId: string) => void;
  registerApi: (viewportId: string, api: ViewportApi | null) => void;
  onUiChange: (viewportId: string, ui: ViewportUiState) => void;
}

export function ViewerCell({
  viewportId,
  items,
  defaultWwWl,
  showInfo,
  isActive,
  onActivate,
  registerApi,
  onUiChange,
}: ViewerCellProps) {
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

  return (
    <div
      className={`viewport-cell${isActive ? ' viewport-cell--active' : ''}`}
      onMouseDown={handleActivate}
    >
      <DicomViewport
        viewportId={viewportId}
        items={items}
        defaultWwWl={defaultWwWl}
        showInfo={showInfo}
        onApiReady={handleApiReady}
        onUiChange={handleUiChange}
      />
    </div>
  );
}
