/**
 * M10-D 校准弹窗（FR-5.8）：候选选择 / 真实长度输入校验 / 提交回调。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CalibrationPanel } from '../src/features/measure/CalibrationPanel';
import type { CalibrationCandidate } from '../src/features/measure/calibration';

const candidates: CalibrationCandidate[] = [
  { annotationUID: 'a', pixelLengthPx: 100, seriesUid: '1.2.s1' },
  { annotationUID: 'b', pixelLengthPx: 200, seriesUid: '1.2.s2' },
];

function makeProps() {
  return {
    open: true,
    onClose: vi.fn(),
    candidates,
    onSubmit: vi.fn(),
  };
}

describe('CalibrationPanel（FR-5.8）', () => {
  afterEach(() => cleanup());

  it('open=false 不渲染', () => {
    const { container } = render(<CalibrationPanel {...makeProps()} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('无候选时提示先画长度线', () => {
    render(<CalibrationPanel {...makeProps()} candidates={[]} />);
    expect(screen.getByText(/先用「长度」工具/)).not.toBeNull();
  });

  it('默认选中最后一条候选；预览比例随输入更新', () => {
    render(<CalibrationPanel {...makeProps()} />);
    const select = screen.getByLabelText('选择长度测量线') as HTMLSelectElement;
    expect(select.value).toBe('b');

    const input = screen.getByLabelText('真实长度（mm）') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50' } });
    // 200px → 50mm → 0.25 mm/px
    expect(screen.getByText(/校准比例 = 0.25 mm\/px/)).not.toBeNull();
  });

  it('非法输入提示错误且不提交', () => {
    const props = makeProps();
    render(<CalibrationPanel {...props} />);
    const input = screen.getByLabelText('真实长度（mm）') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByText('应用校准'));
    expect(screen.getByRole('alert').textContent).toContain('请输入有效的正数长度');
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('有效输入提交（选中的候选 UID + 真实 mm）', () => {
    const props = makeProps();
    render(<CalibrationPanel {...props} />);
    const input = screen.getByLabelText('真实长度（mm）') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.click(screen.getByText('应用校准'));
    expect(props.onSubmit).toHaveBeenCalledWith('b', 100);
  });

  it('关闭按钮触发 onClose', () => {
    const props = makeProps();
    render(<CalibrationPanel {...props} />);
    fireEvent.click(screen.getByLabelText('关闭校准'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});