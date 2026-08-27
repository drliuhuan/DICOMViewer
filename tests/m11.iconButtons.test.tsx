/**
 * M11 任务 4：按钮图标化——每个被改造的按钮均包含内联 SVG 图标，
 * 且 tooltip（title）与可访问名称（aria-label/title/文案 span）保持。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { SettingsPanel } from '../src/ui/components/SettingsPanel';
import { HelpOverlay } from '../src/ui/components/HelpOverlay';
import { ErrorReportPanel } from '../src/ui/components/ErrorReportPanel';
import { CalibrationPanel } from '../src/features/measure/CalibrationPanel';
import { AnnotationsPanel } from '../src/features/measure/AnnotationsPanel';
import type { AnnotationRow } from '../src/features/measure/annotationModel';

/** 断言元素本身是含 <svg> 的按钮且 title/aria 之一提供语义 */
function expectIconified(button: HTMLElement): void {
  expect(button.querySelector('svg')).not.toBeNull();
  const named =
    button.getAttribute('title') !== null ||
    button.getAttribute('aria-label') !== null;
  // 无静态 title 的按钮（如错误报告折叠钮）由文案 span 提供可读名
  if (!named) {
    expect(button.textContent).not.toBe('');
  }
}

afterEach(() => {
  cleanup();
});

describe('面板按钮图标化（M11 任务 4）', () => {
  it('设置面板：关闭为图标；重置带图标+tooltip', () => {
    render(
      <SettingsPanel
        settings={{
          theme: 'dark',
          language: 'zh',
          maxImageCacheMb: 512,
          thumbnailMaxCount: 100,
        }}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );
    const close = screen.getByLabelText(/关闭设置/);
    expectIconified(close);
    const reset = screen.getByRole('button', { name: /恢复默认设置/ });
    expectIconified(reset);
    expect(reset.getAttribute('title')).toContain('默认设置');
  });

  it('帮助浮层关闭按钮为图标', () => {
    let closed = false;
    render(<HelpOverlay open onClose={() => (closed = true)} />);
    const close = screen.getByLabelText(/关闭/);
    expectIconified(close);
    fireEvent.click(close);
    expect(closed).toBe(true);
  });

  it('错误报告：折叠按钮携带 chevron 图标并保留文案', () => {
    render(
      <ErrorReportPanel
        failures={[
          { fileName: 'a.txt', message: '非 DICOM 文件类型', kind: 'not-dicom' },
        ]}
      />,
    );
    const toggle = screen.getByText(/查看详情/).closest('button')!;
    expectIconified(toggle);
    expect(toggle.textContent).toContain('查看详情');
  });

  it('校准弹窗：关闭/应用均为图标按钮', () => {
    render(
      <CalibrationPanel
        open
        onClose={() => undefined}
        candidates={[
          { annotationUID: 'u1', pixelLengthPx: 100, seriesUid: null },
        ]}
        onSubmit={() => undefined}
      />,
    );
    expectIconified(screen.getByLabelText(/关闭校准/));
    expectIconified(screen.getByLabelText(/应用校准/));
  });

  it('标注面板：行操作/页脚导出导入均为图标按钮并保留文案', () => {
    const row: AnnotationRow = {
      annotationUID: 'ann-1',
      toolName: 'Length',
      toolLabel: '长度',
      seriesUid: '1.2.s',
      viewportId: 'vp-0',
      frame: 1,
      imageId: 'dcm-file://k1',
      isMpr: false,
      text: '长度 12 mm',
      lines: [],
      numericValue: 12,
      unit: 'mm',
      isVisible: true,
      isSelected: false,
      spacingUsable: true,
    };
    render(
      <AnnotationsPanel
        open
        onClose={() => undefined}
        rows={[row]}
        selectedUid={null}
        onSelect={() => undefined}
        onJump={() => undefined}
        onToggleVisibility={() => undefined}
        onShowAll={() => undefined}
        onHideAll={() => undefined}
        onDelete={() => undefined}
        onClear={() => undefined}
        onExportJson={() => undefined}
        onImportJson={() => undefined}
        canExportSr={false}
        onExportSr={() => undefined}
      />,
    );
    expectIconified(screen.getByLabelText(/关闭标注面板/));
    expectIconified(screen.getByText(/全部显示/).closest('button')!);
    expectIconified(screen.getByText(/全部隐藏/).closest('button')!);
    expectIconified(screen.getByText(/清空标注/).closest('button')!);
    expectIconified(screen.getByText(/^跳转$/).closest('button')!);
    expectIconified(screen.getByText(/^删除$/).closest('button')!);
    const exportJson = screen.getByText(/导出 JSON/).closest('button')!;
    expect(exportJson.querySelector('svg')).not.toBeNull();
    const importJson = screen.getByText(/导入 JSON/).closest('button')!;
    expect(importJson.querySelector('svg')).not.toBeNull();
  });
});
