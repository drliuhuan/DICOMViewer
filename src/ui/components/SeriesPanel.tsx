/**
 * 序列树形导航面板（FR-2.1 / FR-2.2 / FR-2.7，M2-F；M7 虚拟化）。
 *
 * - 左侧面板按 患者 → 检查 → 序列 三级展示；
 * - 序列卡片沿用 M1 的 .series-item 类（点击加载到激活视口、拖拽到指定视口）；
 * - 卡片信息补全：模态、描述、层数、矩阵、像素间距、层厚（FR-2.2）；
 * - 同一患者的多次检查并列分组（FR-2.7）；
 * - M7 性能（NFR-1/NFR-2）：单检查序列数 ≥ VIRTUALIZE_MIN_SERIES 时，
 *   该检查的序列卡片按固定行高窗口化渲染（仅渲染可视区 ± 超扫），
 *   患者/检查标题与少量序列保持原流式结构，小数据集 DOM 不变；
 * - M8（FR-13.5/AC-25）：远程拉取的序列卡片显示「远程」来源标记。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
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

/** 单检查序列数达到该值才启用虚拟化（小列表保持原有 DOM 结构） */
export const VIRTUALIZE_MIN_SERIES = 24;
/** 虚拟化的固定行高（px），需与 CSS .series-item--virtual 一致 */
export const SERIES_ROW_HEIGHT = 64;
const PATIENT_HEADER_HEIGHT = 30;
const STUDY_HEADER_HEIGHT = 26;
const OVERSCAN = 6;
/** jsdom/无布局环境下的可视高度回退值 */
const FALLBACK_VIEWPORT_HEIGHT = 600;

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
  style,
  virtual,
  dataIndex,
}: {
  series: SeriesStack;
  active: boolean;
  thumbnail: string | undefined;
  onLoadSeries: (seriesUid: string) => void;
  onCloseSeries?: (seriesUid: string) => void;
  /** 虚拟化绝对定位样式 */
  style?: React.CSSProperties;
  virtual?: boolean;
  dataIndex?: number;
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
      className={`series-item${active ? ' series-item--active' : ''}${
        virtual ? ' series-item--virtual' : ''
      }`}
      style={style}
      data-index={dataIndex}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onLoadSeries(series.seriesUid)}
      title="点击加载到当前激活视口；拖拽到指定视口放置加载"
    >
      <span className="series-thumb" aria-hidden="true">
        {thumbnail ? (
          <img src={thumbnail} alt="" />
        ) : (
          <span className="series-thumb-placeholder">▦</span>
        )}
      </span>
      <span className="series-item-modality">{series.modality}</span>
      {series.remoteSource !== undefined && (
        <span
          className="series-item-remote"
          title={`远程拉取：${series.remoteSource.serverName} · 检查 ${series.remoteSource.studyUid}`}
        >
          远程
        </span>
      )}
      <span className="series-item-body">
        <span className="series-item-label">{series.description ?? '未命名序列'}</span>
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

/** 计算每个检查序列卡片区的顶部偏移（固定行高 → 纯算术，无需测量 DOM） */
function computeCardsTops(patients: readonly PatientNode[]): Map<string, number> {
  const tops = new Map<string, number>();
  let offset = 0;
  for (const patient of patients) {
    offset += PATIENT_HEADER_HEIGHT;
    for (const study of patient.studies) {
      offset += STUDY_HEADER_HEIGHT;
      tops.set(study.key, offset);
      offset += study.series.length * SERIES_ROW_HEIGHT;
    }
  }
  return tops;
}

/** 单检查内的可见窗口：返回 [first, last]（含边界）；完全不可见时 null */
function visibleCardRange(
  cardTop: number,
  count: number,
  scrollTop: number,
  viewportHeight: number,
): [number, number] | null {
  const localTop = scrollTop - cardTop;
  const localBottom = localTop + viewportHeight;
  const totalHeight = count * SERIES_ROW_HEIGHT;
  if (localBottom < 0 || localTop >= totalHeight) {
    return null;
  }
  const first = Math.max(0, Math.floor(localTop / SERIES_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(count - 1, Math.ceil(localBottom / SERIES_ROW_HEIGHT) + OVERSCAN);
  return [first, last];
}

export function SeriesPanel({
  patients,
  activeUid,
  onLoadSeries,
  onCloseSeries,
  thumbnails,
}: SeriesPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const cardsTops = useMemo(() => computeCardsTops(patients), [patients]);

  const totalSeries = patients.reduce(
    (sum, patient) =>
      sum + patient.studies.reduce((studySum, study) => studySum + study.series.length, 0),
    0,
  );
  if (totalSeries === 0) {
    return null;
  }

  const viewportHeight = listRef.current?.clientHeight || FALLBACK_VIEWPORT_HEIGHT;

  const handleScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <div className="series-panel-inner">
      <div className="series-panel-title">
        序列（{totalSeries}）· 患者（{patients.length}）
      </div>
      <div className="series-panel-list" ref={listRef} onScroll={handleScroll}>
        {patients.map((patient) => (
          <section key={patient.key} className="tree-patient">
            <div className="tree-patient-header" title={patient.id ?? undefined}>
              {patient.name}
              {patient.id !== undefined ? (
                <span className="tree-patient-id"> ({patient.id})</span>
              ) : null}
            </div>
            {patient.studies.map((study: StudyNode) => {
              const cardTop = cardsTops.get(study.key) ?? 0;
              const virtualized = study.series.length >= VIRTUALIZE_MIN_SERIES;
              const range = virtualized
                ? visibleCardRange(cardTop, study.series.length, scrollTop, viewportHeight)
                : null;
              return (
                <div key={study.key} className="tree-study">
                  <div className="tree-study-header">
                    {[study.description ?? '未命名检查', formatDateLabel(study.date)]
                      .filter((part): part is string => part !== undefined)
                      .join(' · ')}
                  </div>
                  {virtualized ? (
                    <div
                      className="series-virtual"
                      style={{ height: study.series.length * SERIES_ROW_HEIGHT }}
                    >
                      {range !== null &&
                        study.series.slice(range[0], range[1] + 1).map((series, i) => {
                          const index = range[0] + i;
                          return (
                            <SeriesCard
                              key={series.seriesUid}
                              series={series}
                              active={series.seriesUid === activeUid}
                              thumbnail={thumbnails?.[series.seriesUid]}
                              onLoadSeries={onLoadSeries}
                              onCloseSeries={onCloseSeries}
                              virtual
                              dataIndex={index}
                              style={{ top: index * SERIES_ROW_HEIGHT }}
                            />
                          );
                        })}
                    </div>
                  ) : (
                    study.series.map((series) => (
                      <SeriesCard
                        key={series.seriesUid}
                        series={series}
                        active={series.seriesUid === activeUid}
                        thumbnail={thumbnails?.[series.seriesUid]}
                        onLoadSeries={onLoadSeries}
                        onCloseSeries={onCloseSeries}
                      />
                    ))
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function formatDateLabel(date: string | undefined): string | undefined {
  return date === undefined ? undefined : (formatDicomDate(date) ?? date);
}
