/**
 * M11-F3 鼠标按键绑定矩阵——2D 真实库集成回归（未 mock @cornerstonejs/tools，
 * 手法同 m1.toolsync.integration.test.ts）。
 *
 * 锁定语义（2D/MPR 共同矩阵；MPR/3D 断言分别在 m10.mprToolGroup.test.ts、
 * m10.vol3dToolGroup.test.ts 更新）：
 * 1. 默认主工具 = Pan：切测量工具 → 左键归测量；切回（null 或显式 Pan）→
 *    左键回归 Pan，测量工具无 Primary 残留（setToolActive merge 缺陷锁）；
 * 2. WindowLevel 常驻 Auxiliary：任何主工具下中键调窗可用
 *    （Active 且 bindings 恒含 Auxiliary；主工具态另有 Primary）；
 * 3. StackScroll 常驻 Wheel + Secondary（滚轮/右键拖动翻层）、
 *    Zoom 常驻 Ctrl+滚轮（与双指触摸绑定不丢）；
 * 4. 未知主工具名（如 2D ToolGroup 收到 MPR 的 Crosshairs）回退默认 Pan。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Enums, ToolGroupManager } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';
import {
  ALL_TOOL_NAMES,
  DEFAULT_PRIMARY_TOOL,
  MEASUREMENT_TOOLS,
  ToolNames,
  destroyBoundToolGroup,
  initializeTools,
  syncToolBindings,
} from '../src/features/viewer/toolSetup';

const { Primary, Auxiliary, Secondary, Wheel } = Enums.MouseBindings;
const CtrlWheel = {
  mouseButton: Wheel,
  modifierKey: Enums.KeyboardBindings.Ctrl,
};

type ToolOption = { mode: string; bindings: Array<Record<string, unknown>> };

function optionOf(group: Types.IToolGroup, toolName: string): ToolOption {
  const table = group.toolOptions as unknown as Record<string, ToolOption | undefined>;
  const option = table[toolName];
  if (!option) {
    throw new Error(`toolOptions 缺少 ${toolName}`);
  }
  return option;
}

function primaryHolders(group: Types.IToolGroup): string[] {
  return Object.entries(group.toolOptions as unknown as Record<string, ToolOption>)
    .filter(([, option]) =>
      option.bindings.some((binding) => binding.mouseButton === Primary),
    )
    .map(([name]) => name);
}

/** 常驻绑定不变式：任意主工具下恒成立（M11-F3 矩阵） */
function assertPersistentBindings(group: Types.IToolGroup): void {
  const wl = optionOf(group, ToolNames.windowLevel);
  expect(wl.mode).toBe(Enums.ToolModes.Active);
  expect(wl.bindings).toContainEqual({ mouseButton: Auxiliary });
  const zoom = optionOf(group, ToolNames.zoom);
  expect(zoom.mode).toBe(Enums.ToolModes.Active);
  expect(zoom.bindings).toContainEqual(CtrlWheel);
  expect(zoom.bindings).toContainEqual({ numTouchPoints: 2 });
  const stackScroll = optionOf(group, ToolNames.stackScroll);
  expect(stackScroll.mode).toBe(Enums.ToolModes.Active);
  expect(stackScroll.bindings).toContainEqual({ mouseButton: Wheel });
  expect(stackScroll.bindings).toContainEqual({ mouseButton: Secondary });
}

describe('M11-F3 绑定矩阵 × 真实 ToolGroup（2D）', () => {
  let group: Types.IToolGroup | undefined;

  beforeEach(async () => {
    await initializeTools();
  });

  afterEach(() => {
    if (group) {
      destroyBoundToolGroup(group);
      group = undefined;
    }
  });

  function freshGroup(): Types.IToolGroup {
    const created = ToolGroupManager.createToolGroup('m11-f3-engine');
    if (!created) {
      throw new Error('创建 ToolGroup 失败: m11-f3-engine/vp-m11');
    }
    group = created;
    for (const toolName of ALL_TOOL_NAMES) {
      group.addTool(toolName);
    }
    syncToolBindings(group, null);
    return group;
  }

  it('DEFAULT_PRIMARY_TOOL 导出为 Pan；默认态左键=Pan、中键=窗宽窗位', () => {
    expect(DEFAULT_PRIMARY_TOOL).toBe(ToolNames.pan);
    const g = freshGroup();
    expect(optionOf(g, ToolNames.pan).mode).toBe(Enums.ToolModes.Active);
    expect(optionOf(g, ToolNames.pan).bindings).toContainEqual({ mouseButton: Primary });
    expect(optionOf(g, ToolNames.windowLevel).bindings).toContainEqual({ mouseButton: Auxiliary });
    expect(g.getActivePrimaryMouseButtonTool()).toBe(ToolNames.pan);
  });

  it('切测量再切回（null）：左键回归 Pan，测量工具无 Primary 残留', () => {
    const g = freshGroup();
    for (const measurement of MEASUREMENT_TOOLS) {
      syncToolBindings(g, measurement);
      expect(optionOf(g, measurement).bindings).toContainEqual({ mouseButton: Primary });
      expect(primaryHolders(g)).toEqual([measurement]);
    }

    syncToolBindings(g, null);
    expect(optionOf(g, ToolNames.pan).bindings).toContainEqual({ mouseButton: Primary });
    expect(primaryHolders(g)).toEqual([ToolNames.pan]);
    for (const measurement of MEASUREMENT_TOOLS) {
      expect(optionOf(g, measurement).bindings).not.toContainEqual({ mouseButton: Primary });
    }
    assertPersistentBindings(g);
  });

  it('切测量再切回（显式 Pan）：左键同样回归 Pan（App 工具栏二次点击语义）', () => {
    const g = freshGroup();
    syncToolBindings(g, ToolNames.length);
    syncToolBindings(g, ToolNames.pan);

    expect(optionOf(g, ToolNames.pan).bindings).toContainEqual({ mouseButton: Primary });
    expect(optionOf(g, ToolNames.length).bindings).not.toContainEqual({ mouseButton: Primary });
    expect(g.getActivePrimaryMouseButtonTool()).toBe(ToolNames.pan);
    assertPersistentBindings(g);
  });

  it('WindowLevel 常驻 Auxiliary：任何主工具下 Active 且含中键绑定', () => {
    const g = freshGroup();
    const primaries: Array<string | null> = [
      ToolNames.pan,
      ToolNames.zoom,
      ToolNames.stackScroll,
      ToolNames.windowLevel,
      ...MEASUREMENT_TOOLS,
      null,
    ];
    for (const primary of primaries) {
      syncToolBindings(g, primary);
      const wl = optionOf(g, ToolNames.windowLevel);
      expect(wl.mode).toBe(Enums.ToolModes.Active);
      expect(wl.bindings).toContainEqual({ mouseButton: Auxiliary });
      if (primary === ToolNames.windowLevel) {
        // 显式选窗宽窗位为主工具：左键+中键并存
        expect(wl.bindings).toContainEqual({ mouseButton: Primary });
      } else {
        expect(wl.bindings).not.toContainEqual({ mouseButton: Primary });
      }
      assertPersistentBindings(g);
    }
  });

  it('未知主工具名（MPR Crosshairs）回退默认 Pan，不产生孤儿 Primary', () => {
    const g = freshGroup();
    syncToolBindings(g, 'Crosshairs');

    expect(optionOf(g, ToolNames.pan).bindings).toContainEqual({ mouseButton: Primary });
    expect(primaryHolders(g)).toEqual([ToolNames.pan]);
    assertPersistentBindings(g);
  });
});
