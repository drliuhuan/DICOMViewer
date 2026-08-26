/**
 * M10-E 快捷键新增键位测试（FR-3.9 反色 / FR-3.10 旋转）。
 * 既有键位行为由 m1/m7.shortcuts.test.ts 覆盖，此处仅断言新增项不改动旧键。
 */
import { describe, expect, it } from 'vitest';
import { resolveShortcut } from '../src/features/shortcuts/shortcuts';

const base = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe('M10-E 新增快捷键（FR-3.8/3.9/3.10）', () => {
  it('Shift+I → 反色；I（无 Shift）仍为信息覆盖（不覆盖既有键位）', () => {
    expect(resolveShortcut({ ...base, key: 'I', shiftKey: true })).toEqual({ type: 'invert' });
    expect(resolveShortcut({ ...base, key: 'i', shiftKey: true })).toEqual({ type: 'invert' });
    expect(resolveShortcut({ key: 'i', ...base })).toEqual({ type: 'toggleInfo' });
    expect(resolveShortcut({ key: 'I', ...base })).toEqual({ type: 'toggleInfo' });
  });

  it('[ / ] → 逆时针/顺时针旋转（FR-3.10）', () => {
    expect(resolveShortcut({ key: '[', ...base })).toEqual({ type: 'rotateLeft' });
    expect(resolveShortcut({ key: ']', ...base })).toEqual({ type: 'rotateRight' });
  });

  it('空格键 Cine 占位动作保留（App 内已转正为播放/暂停）（FR-3.8）', () => {
    expect(resolveShortcut({ key: ' ', ...base })).toEqual({ type: 'cinePlaceholder' });
  });

  it('组合键约束仍适用', () => {
    expect(resolveShortcut({ ...base, key: '[', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ ...base, key: ']', altKey: true })).toBeNull();
    expect(resolveShortcut({ ...base, key: 'i', shiftKey: true, metaKey: true })).toBeNull();
  });
});