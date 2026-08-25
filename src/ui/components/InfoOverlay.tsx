/**
 * 信息覆盖文字（FR-4，四角布局 + 解剖方向标记）。
 *
 * - 左上：患者（姓名/ID/性别/年龄）（FR-4.2）
 * - 右上：检查（日期/描述/机构）（FR-4.3）
 * - 左下：序列（模态/层号/层厚/矩阵）（FR-4.4）
 * - 右下：像素区（光标坐标/灰度值(HU)/WW/WL/缩放比例）（FR-4.5）
 * - 边缘中点：基于 ImageOrientationPatient 的解剖方向标签（FR-4.10）
 */
import { computeOrientationMarkers } from '../../features/viewer/orientation';
import type { DicomInstanceSummary } from '../../dicom/parseDicom';
import type { PixelProbe } from '../../features/viewer/probeTypes';

interface InfoOverlayProps {
  summary: DicomInstanceSummary;
  /** 「第 X / N 层」文本 */
  sliceLabel: string;
  ww: number;
  wl: number;
  zoomPercent: number;
  probe: PixelProbe | null;
}

/** DICOM DA (YYYYMMDD) → YYYY-MM-DD（供序列面板等处复用） */
export function formatDicomDate(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{8}$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function Line({ label, value }: { label: string; value: string | undefined }) {
  if (value === undefined) {
    return null;
  }
  return (
    <div>
      {label}: {value}
    </div>
  );
}

export function InfoOverlay({
  summary,
  sliceLabel,
  ww,
  wl,
  zoomPercent,
  probe,
}: InfoOverlayProps) {
  const markers = computeOrientationMarkers(summary.imageOrientationPatient);
  return (
    <div className="info-overlay" aria-hidden="true">
      {markers !== null && (
        <>
          <span className="orient-label orient-top">{markers.top}</span>
          <span className="orient-label orient-bottom">{markers.bottom}</span>
          <span className="orient-label orient-left">{markers.left}</span>
          <span className="orient-label orient-right">{markers.right}</span>
        </>
      )}

      <div className="info-corner info-topleft">
        <Line label="姓名" value={summary.patientName} />
        <Line label="ID" value={summary.patientId} />
        <Line label="性别" value={summary.patientSex} />
        <Line label="年龄" value={summary.patientAge} />
      </div>

      <div className="info-corner info-topright">
        <Line label="检查日期" value={formatDicomDate(summary.studyDate)} />
        <Line label="检查描述" value={summary.studyDescription} />
        <Line label="机构" value={summary.institutionName} />
      </div>

      <div className="info-corner info-bottomleft">
        <Line label="模态" value={summary.modality} />
        <div>层号: {sliceLabel}</div>
        <Line
          label="层厚"
          value={
            summary.sliceThickness !== undefined ? `${summary.sliceThickness} mm` : undefined
          }
        />
        <div>
          矩阵: {summary.rows}×{summary.columns}
        </div>
      </div>

      <div className="info-corner info-bottomright">
        {probe !== null && (
          <>
            <div>
              坐标: ({probe.imageX}, {probe.imageY}) px
            </div>
            <div>
              灰度: {probe.valueText ?? '—'}
            </div>
          </>
        )}
        <div>
          WW/WL: {ww.toFixed(0)} / {wl.toFixed(0)}
        </div>
        <div>缩放: {zoomPercent.toFixed(0)}%</div>
      </div>
    </div>
  );
}
