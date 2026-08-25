/**
 * M0 最小信息覆盖文字（仅为验证渲染管线，FR-4 全量信息面板在后续里程碑实现）。
 */
import type { DicomInstanceSummary } from '../../dicom/parseDicom';

interface InfoOverlayProps {
  summary: DicomInstanceSummary;
}

export function InfoOverlay({ summary }: InfoOverlayProps) {
  return (
    <div className="info-overlay">
      <div>PatientName: {summary.patientName}</div>
      <div>Modality: {summary.modality}</div>
      <div>
        Rows×Cols: {summary.rows}×{summary.columns}
        {summary.numberOfFrames > 1
          ? `（${summary.numberOfFrames} 帧）`
          : ''}
      </div>
    </div>
  );
}
