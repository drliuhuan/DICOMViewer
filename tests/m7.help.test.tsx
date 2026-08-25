/**
 * M7 快捷键帮助浮层测试（FR-11：应用内提供快捷键速查表入口）：
 * - open=false 不渲染；open=true 渲染对话框与完整快捷键表；
 * - 表格行与 SHORTCUT_TABLE 逐行一致（键位 + 当前语言文案）；
 * - Esc / 关闭按钮 / 遮罩点击均可关闭，浮层内部点击不关闭；
 * - 语言切换（en）后文案随之切换。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpOverlay, SHORTCUT_TABLE } from '../src/ui/components/HelpOverlay';
import { I18nProvider } from '../src/ui/i18n/i18n';
import { ZH } from '../src/ui/i18n/zh';
import { EN } from '../src/ui/i18n/en';

function renderHelp(props: Partial<{ open: boolean; onClose: () => void }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <I18nProvider>
      <HelpOverlay open={props.open ?? true} onClose={onClose} />
    </I18nProvider>,
  );
  return { ...view, onClose };
}

describe('HelpOverlay（快捷键速查浮层）', () => {
  afterEach(() => cleanup());

  it('open=false 时不渲染任何内容', () => {
    const { container } = renderHelp({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('渲染对话框，且每行键位/文案与 SHORTCUT_TABLE 一一对应', () => {
    renderHelp();
    expect(screen.getByRole('dialog', { name: ZH['help.title'] })).not.toBeNull();
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(SHORTCUT_TABLE.length + 1);
    const dataRows = rows.slice(1);
    SHORTCUT_TABLE.forEach((row, i) => {
      const cells = dataRows[i]!.querySelectorAll('td');
      expect(cells[0]!.textContent).toBe(row.keys);
      expect(cells[1]!.textContent).toBe(ZH[row.labelKey]);
    });
    // M7 新增的占位快捷键（Cine/定位线/删除标注）在表中可见
    expect(screen.getByText(ZH['help.row.cine']!)).not.toBeNull();
    expect(screen.getByText(ZH['help.row.crosshair']!)).not.toBeNull();
    expect(screen.getByText(ZH['help.row.delete']!)).not.toBeNull();
  });

  it('Esc 关闭；关闭态不监听键盘', () => {
    const { onClose } = renderHelp();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    renderHelp({ open: false, onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮 / 遮罩点击关闭，浮层内部点击不关闭', () => {
    const { onClose, container } = renderHelp();
    fireEvent.click(screen.getByRole('button', { name: ZH['help.close'] }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.help-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.help-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('语言为 en 时标题与行文案使用英文词典', () => {
    render(
      <I18nProvider initialLang="en">
        <HelpOverlay open onClose={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('dialog', { name: EN['help.title'] })).not.toBeNull();
    expect(screen.getByText(EN['help.row.cine']!)).not.toBeNull();
  });
});
