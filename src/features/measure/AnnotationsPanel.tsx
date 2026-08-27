/**
 * 标注管理面板（FR-5.9，M10-D）。
 *
 * 纯展示组件：行数据与操作由父组件（App）注入，便于单测。
 * - 列出全部标注（类型/数值/所属视口/帧）；
 * - 选中高亮、跳转（切到对应视口帧）、显隐、删除、清空；
 * - 标注导入导出 JSON（FR-5.11）与 DICOM SR 导出（FR-5.12）入口。
 */
import { useRef } from 'react';
import type { AnnotationRow } from './annotationModel';
import {
  IconClose,
  IconEye,
  IconEyeOff,
  IconFileDown,
  IconFileSr,
  IconFileUp,
  IconTarget,
  IconTrash,
} from '../../ui/icons';

export interface AnnotationsPanelProps {
  open: boolean;
  onClose: () => void;
  rows: readonly AnnotationRow[];
  selectedUid: string | null;
  onSelect: (row: AnnotationRow) => void;
  /** 跳转到标注所在视口/帧 */
  onJump: (row: AnnotationRow) => void;
  onToggleVisibility: (row: AnnotationRow) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onDelete: (row: AnnotationRow) => void;
  onClear: () => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
  /** DICOM SR 导出（FR-5.12）；无可导出数据时禁用 */
  canExportSr: boolean;
  onExportSr: () => void;
}

export function AnnotationsPanel({
  open,
  onClose,
  rows,
  selectedUid,
  onSelect,
  onJump,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  onDelete,
  onClear,
  onExportJson,
  onImportJson,
  canExportSr,
  onExportSr,
}: AnnotationsPanelProps) {
  const importRef = useRef<HTMLInputElement | null>(null);

  if (!open) {
    return null;
  }

  return (
    <div className="annotations-panel" role="dialog" aria-label="标注管理">
      <div className="annotations-panel-header">
        <span>
          标注管理 <span className="annotations-count">（{rows.length}）</span>
        </span>
        <button
          type="button"
          className="tool-button"
          aria-label="关闭标注面板"
          onClick={onClose}
        >
          <IconClose />
        </button>
      </div>

      <div className="annotations-panel-actions">
        <button type="button" className="tool-button" aria-label="全部显示" onClick={onShowAll}>
          <IconEye />
          <span className="tool-button-label">全部显示</span>
        </button>
        <button type="button" className="tool-button" aria-label="全部隐藏" onClick={onHideAll}>
          <IconEyeOff />
          <span className="tool-button-label">全部隐藏</span>
        </button>
        <button
          type="button"
          className="tool-button annotations-danger"
          aria-label="清空标注"
          onClick={onClear}
        >
          <IconTrash />
          <span className="tool-button-label">清空标注</span>
        </button>
      </div>

      <div className="annotations-list" role="list">
        {rows.length === 0 && (
          <div className="annotations-empty">暂无标注（长度/角度/ROI 工具绘制后在此管理）</div>
        )}
        {rows.map((row) => {
          const selected = row.annotationUID === selectedUid;
          return (
            <div
              key={row.annotationUID}
              role="listitem"
              className={`annotations-row${selected ? ' annotations-row--selected' : ''}${
                row.isVisible ? '' : ' annotations-row--hidden'
              }`}
              onClick={() => onSelect(row)}
            >
              <button
                type="button"
                className="annotations-visibility"
                title={row.isVisible ? '隐藏标注' : '显示标注'}
                aria-label={row.isVisible ? '隐藏标注' : '显示标注'}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisibility(row);
                }}
              >
                {row.isVisible ? <IconEye size={13} /> : <IconEyeOff size={13} />}
                <span className="tool-button-label">{row.isVisible ? '显' : '隐'}</span>
              </button>
              <div className="annotations-row-main">
                <div className="annotations-row-title">
                  <span className="annotations-tool">{row.toolLabel}</span>
                  {!row.spacingUsable && (
                    <span className="annotations-warn" title="像素间距缺失，无法计算物理尺寸">
                      （无间距）
                    </span>
                  )}
                </div>
                <div className="annotations-row-text">{row.text}</div>
                {row.lines.length > 0 && (
                  <div className="annotations-row-lines">
                    {row.lines.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                )}
                <div className="annotations-row-meta">
                  <span>{row.viewportId ?? '未关联视口'}</span>
                  {row.frame !== null && (
                    <>
                      <span className="annotations-meta-sep">·</span>
                      <span>第 {row.frame} 帧</span>
                    </>
                  )}
                  {row.isMpr && (
                    <>
                      <span className="annotations-meta-sep">·</span>
                      <span>MPR</span>
                    </>
                  )}
                </div>
              </div>
              <div className="annotations-row-buttons">
                <button
                  type="button"
                  className="tool-button"
                  title="跳转到该标注所在视口与帧"
                  onClick={(event) => {
                    event.stopPropagation();
                    onJump(row);
                  }}
                >
                  <IconTarget size={13} />
                  <span className="tool-button-label">跳转</span>
                </button>
                <button
                  type="button"
                  className="tool-button annotations-danger"
                  title="删除该标注"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(row);
                  }}
                >
                  <IconTrash size={13} />
                  <span className="tool-button-label">删除</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="annotations-panel-footer">
        <button type="button" className="tool-button" aria-label="导出标注 JSON" onClick={onExportJson}>
          <IconFileDown />
          <span className="tool-button-label">导出 JSON</span>
        </button>
        <button
          type="button"
          className="tool-button"
          aria-label="导入标注 JSON"
          onClick={() => importRef.current?.click()}
        >
          <IconFileUp />
          <span className="tool-button-label">导入 JSON</span>
        </button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="file-input"
          aria-label="导入标注 JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onImportJson(file);
            }
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="tool-button"
          disabled={!canExportSr}
          title={canExportSr ? '导出为 DICOM SR' : '没有可导出的测量标注'}
          onClick={onExportSr}
        >
          <IconFileSr />
          <span className="tool-button-label">导出 SR</span>
        </button>
      </div>
    </div>
  );
}