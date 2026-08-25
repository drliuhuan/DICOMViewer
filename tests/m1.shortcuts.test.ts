/**
 * M1 快捷键解析与输入框守卫测试（FR-11 子集）。
 */
import { describe, expect, it } from 'vitest';
import {
  isTextInputTarget,
  resolveShortcut,
} from '../src/features/shortcuts/shortcuts';

const base = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe('resolveShortcut', () => {
  it('功能键映射正确', () => {
    expect(resolveShortcut({ key: 'i', ...base })).toEqual({ type: 'toggleInfo' });
    expect(resolveShortcut({ key: 'w', ...base })).toEqual({
      type: 'tool',
      tool: 'windowLevel',
    });
    expect(resolveShortcut({ key: 'p', ...base })).toEqual({ type: 'tool', tool: 'pan' });
    expect(resolveShortcut({ key: 'z', ...base })).toEqual({ type: 'tool', tool: 'zoom' });
    expect(resolveShortcut({ key: 'f', ...base })).toEqual({ type: 'fit' });
    expect(resolveShortcut({ key: 'Escape', ...base })).toEqual({ type: 'cancelTool' });
  });

  it('大写字母同样命中（CapsLock/Shift 输入容错）', () => {
    expect(resolveShortcut({ key: 'I', ...base })).toEqual({ type: 'toggleInfo' });
  });

  it('测量工具 W/L/A/R/O 中除 Shift+R 外均为占位动作', () => {
    for (const key of ['l', 'a', 'o']) {
      expect(resolveShortcut({ key, ...base })).toEqual({
        type: 'placeholderMeasurement',
      });
    }
    expect(resolveShortcut({ key: 'r', ...base })).toEqual({
      type: 'placeholderMeasurement',
    });
    expect(resolveShortcut({ ...base, key: 'r', shiftKey: true })).toEqual({
      type: 'resetAll',
    });
  });

  it('缩放：+/-（含等号与数字小键盘变体）', () => {
    expect(resolveShortcut({ key: '+', ...base })).toEqual({ type: 'zoomIn' });
    expect(resolveShortcut({ key: '=', ...base })).toEqual({ type: 'zoomIn' });
    expect(resolveShortcut({ key: '-', ...base })).toEqual({ type: 'zoomOut' });
    expect(resolveShortcut({ key: 'NumpadAdd', ...base })).toEqual({ type: 'zoomIn' });
  });

  it('布局快捷键 1/2/4 对应视口数', () => {
    expect(resolveShortcut({ key: '1', ...base })).toEqual({ type: 'layout', cells: 1 });
    expect(resolveShortcut({ key: '2', ...base })).toEqual({ type: 'layout', cells: 2 });
    expect(resolveShortcut({ key: '4', ...base })).toEqual({ type: 'layout', cells: 4 });
  });

  it('翻页键：PageUp/PageDown 与 ←/→', () => {
    expect(resolveShortcut({ key: 'PageUp', ...base })).toEqual({ type: 'slicePrev' });
    expect(resolveShortcut({ key: 'PageDown', ...base })).toEqual({ type: 'sliceNext' });
    expect(resolveShortcut({ key: 'ArrowLeft', ...base })).toEqual({ type: 'slicePrev' });
    expect(resolveShortcut({ key: 'ArrowRight', ...base })).toEqual({ type: 'sliceNext' });
  });

  it('Ctrl/Alt/Meta 组合一律不处理（留给浏览器）', () => {
    expect(resolveShortcut({ ...base, key: 'i', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ ...base, key: 'f', altKey: true })).toBeNull();
    expect(resolveShortcut({ ...base, key: 'r', metaKey: true })).toBeNull();
  });

  it('未定义按键返回 null', () => {
    expect(resolveShortcut({ key: 'q', ...base })).toBeNull();
    expect(resolveShortcut({ key: 'F5', ...base })).toBeNull();
  });
});

describe('isTextInputTarget（FR-11 输入框守卫）', () => {
  // Node 环境无 DOM：用最小桩对象模拟 HTMLElement 接口
  function stubElement(tagName: string, isContentEditable = false): EventTarget {
    return {
      tagName,
      isContentEditable,
      instanceofCheck: true,
    } as unknown as EventTarget;
  }

  it('INPUT/TEXTAREA/SELECT/contentEditable 聚焦时返回 true', () => {
    expect(isTextInputTarget(stubElement('INPUT'))).toBe(true);
    expect(isTextInputTarget(stubElement('TEXTAREA'))).toBe(true);
    expect(isTextInputTarget(stubElement('select'))).toBe(true);
    expect(isTextInputTarget(stubElement('DIV', true))).toBe(true);
  });

  it('普通元素/空目标返回 false', () => {
    expect(isTextInputTarget(stubElement('BODY'))).toBe(false);
    expect(isTextInputTarget(null)).toBe(false);
  });
});
