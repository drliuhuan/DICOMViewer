/**
 * 序列树形导航面板（FR-2.1 / FR-2.2 / FR-2.7，M2-F）。
 *
 * 左侧面板按 患者 → 检查 → 序列 三级展示：
 * - 序列卡片沿用 M1 的 .series-item 类（点击加载到激活视口、拖拽到指定视口）；
 * - 卡片信息补全：模态、描述、层数、矩阵、像素间距、层厚（FR-2.2）；
 * - 同一患者的多次检查并列分组（FR-2.7）。
 */
import { useCallback } from 'react';
import type { SeriesStack } from '../../features/series/buildStacks';
import type { PatientNode, StudyNode } from '../../features/series/seriesTree';
import { SERIES_UID_MIME } from '../../features/viewer/seriesDragDrop';
import { formatDicomDate } from './InfoOverlay';

interface SeriesPanelProps {
  patients: readonly PatientNode[];
  /** 当前激活视口已加载的序列 uid */
  activeUid: string | null;
  onLoadSeries: (seriesUid: string) => void;
  /** 关闭单个序列并释放资源（FR-2.9）；未提供时不渲染关闭按钮 */
  onCloseSeries?: (seriesUid: string) => void;
  /** 序列 uid → 缩略图 dataURL（M2-H；缺省显示占位图标） */
  thumbnails?: Readonly<Record<string, string>>;
}

function formatSpacing(spacing: [number, number] | undefined): string | undefined {
  if (!spacing) {
    return undefined;
  }
  const format = (value: number): string => String(Math.round(value * 1000) / 1000);
  return `${format(spacing[0])}×${format(spacing[1])}mm`;
}

/** 单张序列卡片（信息补全版，FR-2.2） */
function SeriesCard({
  series,
  active,
  thumbnail,
  onLoadSeries,
  onCloseSeries,
}: {
  series: SeriesStack;
  active: boolean;
  thumbnail: string | undefined;
  onLoadSeries: (seriesUid: string) => void;
  onCloseSeries?: (seriesUid: string) => void;
}) {
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(SERIES_UID_MIME, series.seriesUid);
      event.dataTransfer.effectAllowed = 'copy';
    },
    [series.seriesUid],
  );
  const handleClose = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onCloseSeries?.(series.seriesUid);
    },
    [onCloseSeries, series.seriesUid],
  );
  const firstSummary = series.items[0]?.summary;
  const matrix =
    firstSummary && firstSummary.columns > 0 && firstSummary.rows > 0
      ? `${firstSummary.columns}×${firstSummary.rows}`
      : undefined;
  return (
    <button
      type="button"
      className={`series-item${active ? ' series-item--active' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onLoadSeries(series.seriesUid)}
      title="点击加载到当前激活视口；拖拽到指定视口放置加载"
    >
      <span className="series-thumb" aria-hidden="true">
        {thumbnail ? <img src={thumbnail} alt="" /> : <span className="series-thumb-placeholder">▦</span>}
      </span>
      <span className="series-item-modality">{series.modality}</span>
      <span className="series-item-body">
        <span className="series-item-label">
          {series.description ?? '未命名序列'}
        </span>
        <span className="series-item-meta">
          {[
            `${series.items.length} 层`,
            matrix !== undefined ? `矩阵 ${matrix}` : null,
            firstSummary?.pixelSpacing !== undefined
              ? `间距 ${formatSpacing(firstSummary.pixelSpacing)}`
              : null,
            firstSummary?.sliceThickness !== undefined
              ? `层厚 ${Math.round(firstSummary.sliceThickness * 1000) / 1000}mm`
              : null,
          ]
            .filter((part): part is string => part !== null)
            .join(' · ')}
        </span>
      </span>
      {onCloseSeries && (
        <span
          role="button"
          className="series-item-close"
          aria-label={`关闭序列 ${series.description ?? ''}`}
          title="关闭该序列并释放内存"
          onClick={handleClose}
        >
          ×
        </span>
      )}
    </button>
  );
}

export function SeriesPanel({
  patients,
  activeUid,
  onLoadSeries,
  onCloseSeries,
  thumbnails,
}: SeriesPanelProps) {
  const totalSeries = patients.reduce(
    (sum, patient) =>
      sum + patient.studies.reduce((studySum, study) => studySum + study.series.length, 0),
    0,
  );
  if (totalSeries === 0) {
    return null;
  }
  return (
    <>
      <div className="series-panel-title">
        序列（{totalSeries}）· 患者（{patients.length}）
      </div>
      {patients.map((patient) => (
        <section key={patient.key} className="tree-patient">
          <div className="tree-patient-header" title={patient.id ?? undefined}>
            {patient.name}
            {patient.id !== undefined ? (
              <span className="tree-patient-id"> ({patient.id})</span>
            ) : null}
          </div>
          {patient.studies.map((study: StudyNode) => (
            <div key={study.key} className="tree-study">
              <div className="tree-study-header">
                {[
                  study.description ?? '未命名检查',
                  formatDateLabel(study.date),
                ]
                  .filter((part): part is string => part !== undefined)
                  .join(' · ')}
              </div>
              {study.series.map((series) => (
                <SeriesCard
                  key={series.seriesUid}
                  series={series}
                  active={series.seriesUid === activeUid}
                  thumbnail={thumbnails?.[series.seriesUid]}
                  onLoadSeries={onLoadSeries}
                  onCloseSeries={onCloseSeries}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function formatDateLabel(date: string | undefined): string | undefined {
  return date === undefined ? undefined : (formatDicomDate(date) ?? date);
}
