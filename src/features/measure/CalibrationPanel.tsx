/**
 * 手动校准弹窗（FR-5.8，M10-D）。
 *
 * 像素间距缺失/为 0 时，长度测量画线仅有像素长度。此面板让用户选择一条
 * 画好的长度线、输入其真实物理长度（mm），据此计算校准比例（mm/px）。
 */
import { useEffect, useState } from 'react';
import type { CalibrationCandidate } from './calibration';
import { formatCalibrationScale, parsePhysicalLengthMm } from './calibration';
import { formatFixed2 } from './roiStats';

export interface CalibrationPanelProps {
  open: boolean;
  onClose: () => void;
  /** 可用的长度标注候选（含像素长度；空则提示先画线） */
  candidates: readonly CalibrationCandidate[];
  /** 提交校准：annotationUID + 真实长度 mm */
  onSubmit: (annotationUID: string, physicalLengthMm: number) => void;
}

export function CalibrationPanel({
  open,
  onClose,
  candidates,
  onSubmit,
}: CalibrationPanelProps) {
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [realMm, setRealMm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 打开时自动选中最后一条候选并清空输入
  useEffect(() => {
    if (open) {
      const last = candidates[candidates.length - 1];
      setSelectedUid(last?.annotationUID ?? '');
      setRealMm('');
      setError(null);
    }
  }, [open, candidates]);

  if (!open) {
    return null;
  }

  const selected = candidates.find((item) => item.annotationUID === selectedUid) ?? null;

  const handleSubmit = () => {
    const value = parsePhysicalLengthMm(realMm);
    if (value !== null && selected !== null) {
      onSubmit(selected.annotationUID, value);
      return;
    }
    setError(value === null ? '请输入有效的正数长度（mm）' : '请先选择一条长度测量线');
  };

  return (
    <div className="calibrate-backdrop" role="presentation">
      <div className="calibrate-panel" role="dialog" aria-modal="true" aria-label="手动校准">
        <div className="calibrate-panel-header">
          <span>手动校准（像素间距缺失）</span>
          <button type="button" className="tool-button" aria-label="关闭校准" onClick={onClose}>
            ×
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="calibrate-hint">
            先用「长度」工具在图像上画一条已知物理长度的线段，再在此输入其真实长度进行校准。
          </p>
        ) : (
          <>
            <label className="calibrate-field">
              <span>长度测量线（像素长度）</span>
              <select
                value={selectedUid}
                onChange={(event) => {
                  setSelectedUid(event.target.value);
                  setError(null);
                }}
                aria-label="选择长度测量线"
              >
                {candidates.map((item, index) => (
                  <option key={item.annotationUID} value={item.annotationUID}>
                    第 {index + 1} 条 · {formatFixed2(item.pixelLengthPx) ?? '--'} px
                    {item.seriesUid !== null ? ` · ${item.seriesUid.slice(0, 8)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="calibrate-field">
              <span>该线段的真实长度（mm）</span>
              <input
                type="number"
                className="calibrate-input"
                min={0}
                step={0.1}
                value={realMm}
                placeholder="例如 50"
                onChange={(event) => {
                  setRealMm(event.target.value);
                  setError(null);
                }}
                aria-label="真实长度（mm）"
              />
            </label>
            {selected !== null && (
              <p className="calibrate-preview">
                校准比例 = {previewScale(selected.pixelLengthPx, realMm)}
              </p>
            )}
            {error !== null && (
              <p role="alert" className="calibrate-error">
                {error}
              </p>
            )}
            <div className="calibrate-panel-actions">
              <button type="button" className="tool-button" onClick={handleSubmit}>
                应用校准
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function previewScale(pixelLengthPx: number, realMm: string): string {
  const value = parsePhysicalLengthMm(realMm);
  if (value === null) {
    return '--';
  }
  return formatCalibrationScale(value / pixelLengthPx);
}