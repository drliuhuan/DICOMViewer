/**
 * M10-D 标注管理面板（FR-5.9）：列表渲染 / 选中高亮 / 跳转 / 显隐 / 删除 / 清空 /
 * JSON 导入导出与 SR 导出入口。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AnnotationsPanel } from '../src/features/measure/AnnotationsPanel';
import type { AnnotationRow } from '../src/features/measure/annotationModel';

function row(overrides: Partial<AnnotationRow> & { annotationUID: string }): AnnotationRow {
  return {
    toolName: 'Length',
    toolLabel: '长度',
    seriesUid: '1.2.s1',
    viewportId: 'vp-0',
    frame: 1,
    imageId: 'dcm-file://k1',
    isMpr: false,
    text: '长度 20 mm',
    lines: [],
    numericValue: 20,
    unit: 'mm',
    isVisible: true,
    isSelected: false,
    spacingUsable: true,
    ...overrides,
  };
}

function makeProps(overrides: Partial<Parameters<typeof AnnotationsPanel>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    rows: [row({ annotationUID: 'a' }), row({ annotationUID: 'b', toolLabel: '椭圆 ROI', text: '面积 25 mm²' })],
    selectedUid: null,
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onToggleVisibility: vi.fn(),
    onShowAll: vi.fn(),
    onHideAll: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    onExportJson: vi.fn(),
    onImportJson: vi.fn(),
    canExportSr: true,
    onExportSr: vi.fn(),
    ...overrides,
  };
}

describe('AnnotationsPanel（FR-5.9）', () => {
  afterEach(() => cleanup());

  it('open=false 不渲染', () => {
    const { container } = render(<AnnotationsPanel {...makeProps({ open: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('列出全部标注（类型/数值/视口/帧）', () => {
    render(<AnnotationsPanel {...makeProps()} />);
    expect(screen.getByText('长度 20 mm')).not.toBeNull();
    expect(screen.getByText('面积 25 mm²')).not.toBeNull();
    expect(screen.getAllByText('vp-0')).toHaveLength(2);
    expect(screen.getAllByText('第 1 帧')).toHaveLength(2);
    expect(screen.getByText('标注管理')).not.toBeNull();
  });

  it('行点击触发选中回调；选中行高亮', () => {
    const props = makeProps({ selectedUid: 'b' });
    render(<AnnotationsPanel {...props} />);
    const second = screen.getByText('面积 25 mm²').closest('.annotations-row')!;
    expect(second.className).toContain('annotations-row--selected');
    fireEvent.click(second);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ annotationUID: 'b' }));
  });

  it('跳转 / 删除 / 显隐按钮分别触发回调', () => {
    const props = makeProps();
    render(<AnnotationsPanel {...props} />);
    const rowEl = screen.getByText('长度 20 mm').closest('.annotations-row')!;

    fireEvent.click(Array.from(rowEl.querySelectorAll('button')).find((b) => b.textContent === '跳转')!);
    expect(props.onJump).toHaveBeenCalledWith(expect.objectContaining({ annotationUID: 'a' }));

    fireEvent.click(Array.from(rowEl.querySelectorAll('button')).find((b) => b.textContent === '删除')!);
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ annotationUID: 'a' }));

    fireEvent.click(Array.from(rowEl.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === '隐藏标注')!);
    expect(props.onToggleVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ annotationUID: 'a', isVisible: true }),
    );
  });

  it('隐藏中的标注带标记，且可见性按钮切换为显示', () => {
    const props = makeProps({ rows: [row({ annotationUID: 'a', isVisible: false })] });
    render(<AnnotationsPanel {...props} />);
    expect(screen.getByTitle('显示标注')).not.toBeNull();
  });

  it('间距不可用时显示（无间距）提示（FR-5.8 联动）', () => {
    render(
      <AnnotationsPanel {...makeProps({ rows: [row({ annotationUID: 'a', spacingUsable: false })] })} />,
    );
    expect(screen.getByText('（无间距）')).not.toBeNull();
  });

  it('批量操作：全部显示 / 全部隐藏 / 清空', () => {
    const props = makeProps();
    render(<AnnotationsPanel {...props} />);
    fireEvent.click(screen.getByText('全部显示'));
    expect(props.onShowAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('全部隐藏'));
    expect(props.onHideAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('清空标注'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('导出 JSON / SR / 导入 JSON 入口', () => {
    const props = makeProps();
    render(<AnnotationsPanel {...props} />);
    fireEvent.click(screen.getByText('导出 JSON'));
    expect(props.onExportJson).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('导出 SR'));
    expect(props.onExportSr).toHaveBeenCalledTimes(1);

    const disabled = screen.getByText('导出 SR').closest('button')!;
    expect(disabled.disabled).toBe(false);
  });

  it('无可导出 SR 时导出按钮禁用', () => {
    render(<AnnotationsPanel {...makeProps({ canExportSr: false })} />);
    expect((screen.getByText('导出 SR').closest('button') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('导入 JSON：选择文件触发 onImportJson', () => {
    const props = makeProps();
    render(<AnnotationsPanel {...props} />);
    const file = new File(['{}'], 'annotations.json', { type: 'application/json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onImportJson).toHaveBeenCalledWith(file);
  });

  it('空列表提示', () => {
    render(<AnnotationsPanel {...makeProps({ rows: [] })} />);
    expect(screen.getByText(/暂无标注/)).not.toBeNull();
  });
});