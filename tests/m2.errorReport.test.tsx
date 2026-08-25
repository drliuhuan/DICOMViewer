/**
 * M2-B 错误报告列表 UI 测试（FR-1.4/1.5）：
 * 汇总行（跳过 N 个非 DICOM / N 个解析失败）+ 可展开详情。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ErrorReportPanel } from '../src/ui/components/ErrorReportPanel';
import type { LoadFailure } from '../src/features/loading/openDicomFiles';

const FAILURES: LoadFailure[] = [
  { fileName: 'a.dcm', message: 'DICOM 解析失败：意外的元素', kind: 'parse-error' },
  { fileName: 'folder/readme', message: '未找到 DICM 文件头，不是有效的 DICOM Part-10 文件', kind: 'not-dicom' },
  { fileName: 'folder/photo.jpg', message: '非 DICOM 文件类型（.jpg）', kind: 'not-dicom' },
];

describe('ErrorReportPanel（FR-1.4/1.5）', () => {
  afterEach(() => cleanup());

  it('汇总条包含非 DICOM 跳过数与解析失败数；默认不展开详情', () => {
    const { container } = render(<ErrorReportPanel failures={FAILURES} />);
    const text = container.textContent ?? '';
    expect(text).toContain('1 个文件解析失败已跳过');
    expect(text).toContain('跳过 2 个非 DICOM 文件');
    expect(text).toContain('查看详情（3）');
    expect(container.querySelector('.error-report-list')).toBeNull();
  });

  it('点击查看详情展开完整列表（文件名+原因），再点收起', () => {
    const { container, getByText } = render(<ErrorReportPanel failures={FAILURES} />);
    fireEvent.click(getByText('查看详情（3）'));
    const items = Array.from(container.querySelectorAll('.error-report-item'));
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('a.dcm');
    expect(items[0]?.textContent).toContain('DICOM 解析失败');
    expect(items[1]?.textContent).toContain('folder/readme');
    expect(items[2]?.classList.contains('error-report-item--skipped')).toBe(true);

    fireEvent.click(getByText('收起'));
    expect(container.querySelector('.error-report-list')).toBeNull();
  });

  it('无失败时不渲染任何内容', () => {
    const { container } = render(<ErrorReportPanel failures={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
