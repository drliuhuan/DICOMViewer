/**
 * 打开结果错误报告（FR-1.4 / FR-1.5，M2-B）。
 *
 * 汇总条展示「跳过 N 个非 DICOM 文件」「N 个文件解析失败」；
 * 「查看详情」可展开完整列表（文件名 + 原因），再次点击收起。
 */
import { useState } from 'react';
import type { LoadFailure } from '../../features/loading/openDicomFiles';
import {
  IconChevronDown,
  IconChevronUp,
} from '../icons';

interface ErrorReportPanelProps {
  failures: readonly LoadFailure[];
}

export function ErrorReportPanel({ failures }: ErrorReportPanelProps) {
  const [expanded, setExpanded] = useState(false);
  if (failures.length === 0) {
    return null;
  }
  const nonDicomCount = failures.filter((f) => f.kind === 'not-dicom').length;
  const parseErrorCount = failures.length - nonDicomCount;
  const parts: string[] = [];
  if (parseErrorCount > 0) {
    parts.push(`${parseErrorCount} 个文件解析失败已跳过`);
  }
  if (nonDicomCount > 0) {
    parts.push(`跳过 ${nonDicomCount} 个非 DICOM 文件`);
  }

  return (
    <section className="error-report" aria-label="打开文件报告">
      <div className="error-report-summary">
        <span>{parts.join('；')}</span>
        <button
          type="button"
          className="error-report-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          <span className="tool-button-label">
            {expanded ? '收起' : `查看详情（${failures.length}）`}
          </span>
        </button>
      </div>
      {expanded && (
        <ul className="error-report-list">
          {failures.map((failure, index) => (
            <li
              key={`${failure.fileName}-${index}`}
              className={`error-report-item${
                failure.kind === 'not-dicom' ? ' error-report-item--skipped' : ''
              }`}
            >
              <span className="error-report-file">{failure.fileName}</span>
              <span className="error-report-reason">{failure.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
