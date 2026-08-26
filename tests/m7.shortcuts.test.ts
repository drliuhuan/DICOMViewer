/**
 * M7 快捷键补全测试（FR-11）：Space（Cine）/ C（MPR 定位线）/ Delete（删除标注）。
 * 既有键位行为由 m1.shortcuts.test.ts 覆盖，此处仅断言新增项与组合键约束。
 */
import { describe, expect, it } from 'vitest';
import { resolveShortcut } from '../src/features/shortcuts/shortcuts';

const base = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe('M7 快捷键补全（FR-11）', () => {
  it('Space → Cine 播放占位动作（FR-3.8 后续里程碑）', () => {
    expect(resolveShortcut({ key: ' ', ...base })).toEqual({ type: 'cinePlaceholder' });
  });

  it('C → MPR 定位线占位动作（FR-6 后续里程碑）', () => {
    expect(resolveShortcut({ key: 'c', ...base })).toEqual({ type: 'crosshairPlaceholder' });
    expect(resolveShortcut({ key: 'C', ...base })).toEqual({ type: 'crosshairPlaceholder' });
  });

  it('Delete / Backspace → 删除选中标注（FR-5.9 转正）', () => {
    expect(resolveShortcut({ key: 'Delete', ...base })).toEqual({
      type: 'deleteAnnotation',
    });
    expect(resolveShortcut({ key: 'Backspace', ...base })).toEqual({
      type: 'deleteAnnotation',
    });
  });

  it('Ctrl/Alt/Meta 组合一律不处理（含新增键位）', () => {
    expect(resolveShortcut({ ...base, key: ' ', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ ...base, key: 'c', altKey: true })).toBeNull();
    expect(resolveShortcut({ ...base, key: 'Delete', metaKey: true })).toBeNull();
  });
});
