/**
 * MPR/3D 进入前的序列选择对话框（M11 任务 1，FR-6.9/FR-7.1 入口前置）。
 *
 * - 列出全部候选序列：序列号/描述/层数(帧)/实例数/模态/来源，
 *   激活视口锁定序列默认选中；
 * - 未核对完整性的序列给出原因提示（进入时自动补载）；
 * - 补载期间展示进度与取消；失败给明确中文错误，可重试或返回。
 */
import { useEffect, useState } from 'react';
import {
  IconCheck,
  IconChevronLeft,
  IconClose,
} from '../icons';
import type { SeriesCandidateRow } from '../../features/series/entryDecision';
import { useT } from '../i18n/i18n';

export type SeriesPickTarget = 'mpr' | 'vol3d';

export interface SeriesPickerBusy {
  /** 阶段文案（如「正在重扫目录…」「正在补拉缺失实例…」） */
  stageLabel: string;
  done: number;
  total: number;
}

export interface SeriesPickerDialogProps {
  open: boolean;
  target: SeriesPickTarget;
  candidates: readonly SeriesCandidateRow[];
  busy?: SeriesPickerBusy | null;
  error?: string | null;
  onConfirm: (seriesUid: string) => void;
  onCancel: () => void;
}

function candidateTitle(
  row: SeriesCandidateRow,
): string {
  return `SeriesInstanceUID: ${row.seriesUid}`;
}

/** 序列号展示：无序列号时退回 UID 前缀，保证每行有稳定主标识 */
export function formatSeriesIdentifier(row: {
  seriesNumber: number | undefined;
  seriesUid: string;
}): string {
  if (row.seriesNumber !== undefined && Number.isFinite(row.seriesNumber)) {
    return `#${row.seriesNumber}`;
  }
  return row.seriesUid.slice(0, 10);
}

export function SeriesPickerDialog({
  open,
  target,
  candidates,
  busy = null,
  error = null,
  onConfirm,
  onCancel,
}: SeriesPickerDialogProps) {
  const { t } = useT();
  const [selectedUid, setSelectedUid] = useState<string>(() => {
    const preferred = candidates.find((row) => row.preferred);
    return preferred?.seriesUid ?? candidates[0]?.seriesUid ?? '';
  });

  // 候选集合变化（首次打开/数据更新）：保持已有选择，否则落到 preferred/首个
  useEffect(() => {
    setSelectedUid((prev) => {
      if (prev !== '' && candidates.some((row) => row.seriesUid === prev)) {
        return prev;
      }
      const preferred = candidates.find((row) => row.preferred);
      return preferred?.seriesUid ?? candidates[0]?.seriesUid ?? '';
    });
  }, [candidates]);

  if (!open) {
    return null;
  }

  const title =
    target === 'mpr' ? t('entry.pick.titleMpr') : t('entry.pick.titleVol3d');
  const isBusy = busy !== null;

  return (
    <div className="calibrate-backdrop" role="presentation">
      <div
        className="series-picker-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="series-picker-header">
          <span>{title}</span>
          <button
            type="button"
            className="tool-button"
            aria-label={t('entry.pick.close')}
            onClick={onCancel}
            disabled={isBusy}
          >
            <IconClose />
          </button>
        </div>

        <p className="series-picker-hint">{t('entry.pick.hint')}</p>

        <div className="series-picker-list" role="radiogroup" aria-label={t('entry.pick.group')}>
          {candidates.map((row) => (
            <label
              key={row.seriesUid}
              className={`series-picker-row${
                selectedUid === row.seriesUid ? ' series-picker-row--active' : ''
              }${isBusy ? ' series-picker-row--locked' : ''}`}
            >
              <input
                type="radio"
                name="series-pick"
                className="series-picker-radio"
                value={row.seriesUid}
                checked={selectedUid === row.seriesUid}
                disabled={isBusy}
                onChange={() => setSelectedUid(row.seriesUid)}
                aria-label={`${formatSeriesIdentifier(row)} ${row.description ?? '未命名序列'}`}
              />
              <span className="series-picker-main" title={candidateTitle(row)}>
                <span className="series-picker-line1">
                  <span className="series-picker-id">
                    {formatSeriesIdentifier(row)}
                  </span>
                  <span className="series-picker-desc">
                    {row.description ?? '未命名序列'}
                  </span>
                  <span className="series-picker-modality">{row.modality}</span>
                  {row.originLabel.startsWith('远程') && (
                    <span className="series-item-remote">远程</span>
                  )}
                </span>
                <span className="series-picker-line2">
                  {t('entry.pick.slices', { count: row.sliceCount })} ·{' '}
                  {t('entry.pick.instances', { count: row.instanceCount })} ·{' '}
                  {row.originLabel}
                  {row.patientName ? ` · ${row.patientName}` : ''}
                </span>
                {row.needsCheck && (
                  <span className="series-picker-warn" role="note">
                    {t('entry.pick.needsCheck')}
                    {row.needsCheckReason ? `：${row.needsCheckReason}` : ''}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        {error !== null && (
          <p role="alert" className="series-picker-error">
            {error}
          </p>
        )}

        {busy !== null && (
          <div className="series-picker-progress" role="status" aria-live="polite">
            <span>
              {busy.stageLabel}
              {busy.total > 0
                ? `（${busy.done} / ${busy.total}）`
                : ''}
            </span>
            <div
              className="load-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={Math.max(busy.total, 1)}
              aria-valuenow={busy.done}
              aria-label={t('entry.pick.progress')}
            >
              <div
                className="load-progress-bar-fill"
                style={{
                  width: `${Math.round(
                    (busy.done / Math.max(1, busy.total)) * 100,
                  )}%`,
                }}
              />
            </div>
            <button
              type="button"
              className="tool-button"
              aria-label={t('entry.pick.cancelFill')}
              onClick={onCancel}
            >
              {t('entry.pick.cancelFillShort')}
            </button>
          </div>
        )}

        <div className="series-picker-actions">
          <button
            type="button"
            className="tool-button tool-button--primary"
            disabled={isBusy || selectedUid === ''}
            title={t('entry.pick.confirmHint')}
            onClick={() => {
              if (selectedUid !== '') {
                onConfirm(selectedUid);
              }
            }}
          >
            <IconCheck />
            <span className="tool-button-label">{t('entry.pick.confirm')}</span>
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={isBusy}
            onClick={onCancel}
          >
            <IconChevronLeft />
            <span className="tool-button-label">{t('entry.pick.back')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
