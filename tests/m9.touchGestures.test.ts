/**
 * M9 触控手势映射（FR-14.1/AC-28）——真实库集成验证。
 *
 * 映射语义（Cornerstone3D 5.8.2，eventDispatchers/shared/getActiveToolForTouchEvent.js）：
 * - 单指触摸（numTouchPoints=1）→ 命中 defaultMousePrimary（Primary）绑定的
 *   工具 = 当前主工具，与桌面左键共用同一套工具状态；
 * - 双指触摸（numTouchPoints=2）→ 命中 { numTouchPoints: 2 } 绑定的 ZoomTool
 *   （内置 pinchToZoom 捏合缩放 + pan 双指平移）。
 *
 * 本文件用未 mock 的 @cornerstonejs/tools（node 环境，同 m1.toolsync 手法）：
 * 1. 锁定 TOUCH_TAP_EVENT 常量与库枚举相等（防事件名漂移）；
 * 2. createBoundToolGroup/syncToolBindings 后 Zoom 恒持 {numTouchPoints:2}
 *    常驻绑定（不随主工具切换丢失）；
 * 3. 按库内匹配规则仿真派发：单指→当前主工具、双指→Zoom，
 *    主工具切换后结论不变。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { Enums, ToolGroupManager } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';
import {
  ALL_TOOL_NAMES,
  ToolNames,
  destroyBoundToolGroup,
  initializeTools,
  syncToolBindings,
} from '../src/features/viewer/toolSetup';
import { TOUCH_TAP_EVENT } from '../src/features/viewer/touchEvents';

const { Primary } = Enums.MouseBindings;
const CtrlWheel = {
  mouseButton: Enums.MouseBindings.Wheel,
  modifierKey: Enums.KeyboardBindings.Ctrl,
};
const TWO_FINGER = { numTouchPoints: 2 };

type ToolOption = { mode: string; bindings: Array<Record<string, unknown>> };

/** 读取 toolOptions（缺失时抛错，避免静默 undefined） */
function optionOf(group: Types.IToolGroup, toolName: string): ToolOption {
  const table = group.toolOptions as unknown as Record<string, ToolOption | undefined>;
  const option = table[toolName];
  if (!option) {
    throw new Error(`toolOptions 缺少 ${toolName}`);
  }
  return option;
}

/** 与库源码 getActiveToolForTouchEvent 一致的匹配逻辑（无修饰键场景） */
function activeToolForTouch(group: Types.IToolGroup, numTouchPoints: number): string | null {
  const toolOptionsTable = group.toolOptions as unknown as Record<string, ToolOption | undefined>;
  const defaultMousePrimary = group.getDefaultMousePrimary();
  for (const toolName of Object.keys(toolOptionsTable)) {
    const toolOptions = toolOptionsTable[toolName];
    if (!toolOptions) {
      continue;
    }
    const correctBinding =
      toolOptions.bindings.length > 0 &&
      toolOptions.bindings.some(
        (binding) =>
          (binding.numTouchPoints === numTouchPoints ||
            (numTouchPoints === 1 && binding.mouseButton === defaultMousePrimary)) &&
          binding.modifierKey === undefined,
      );
    if (toolOptions.mode === Enums.ToolModes.Active && correctBinding) {
      return toolName;
    }
  }
  return null;
}

describe('TOUCH_TAP_EVENT 常量（防漂移）', () => {
  it('与 @cornerstonejs/tools 库枚举相等', () => {
    expect(Enums.Events.TOUCH_TAP).toBe('CORNERSTONE_TOOLS_TAP');
    expect(TOUCH_TAP_EVENT).toBe(Enums.Events.TOUCH_TAP);
  });
});

describe('双指触控绑定（真实 ToolGroup）', () => {
  let group: Types.IToolGroup;

  beforeEach(async () => {
    await initializeTools();
    if (group) {
      destroyBoundToolGroup(group);
    }
    const created = ToolGroupManager.createToolGroup('m9-touch-engine');
    if (!created) {
      throw new Error('创建 ToolGroup 失败: m9-touch-engine/vp-m9');
    }
    group = created;
    for (const toolName of ALL_TOOL_NAMES) {
      group.addTool(toolName);
    }
    syncToolBindings(group, ToolNames.windowLevel);
  });

  it('创建后 Zoom 持 {numTouchPoints:2} 常驻绑定（Active，与 Ctrl+滚轮并存）', () => {
    const zoom = optionOf(group, ToolNames.zoom);
    expect(zoom.mode).toBe(Enums.ToolModes.Active);
    expect(zoom.bindings).toContainEqual(TWO_FINGER);
    expect(zoom.bindings).toContainEqual(CtrlWheel);
    // 双指绑定不占用鼠标键（不与任何工具的主工具 Primary 冲突）
    expect(zoom.bindings.find((b) => b.numTouchPoints === 2)?.mouseButton).toBeUndefined();
  });

  it('派发仿真：单指 → 当前主工具（默认窗宽窗位）', () => {
    expect(activeToolForTouch(group, 1)).toBe(ToolNames.windowLevel);
  });

  it('派发仿真：双指 → Zoom（默认主工具下）', () => {
    expect(activeToolForTouch(group, 2)).toBe(ToolNames.zoom);
  });

  it('主工具切到 pan 后：单指 → pan；双指仍 → zoom', () => {
    syncToolBindings(group, ToolNames.pan);
    expect(activeToolForTouch(group, 1)).toBe(ToolNames.pan);
    expect(activeToolForTouch(group, 2)).toBe(ToolNames.zoom);
    // 双指绑定在主工具切换全程恒保留
    expect(optionOf(group, ToolNames.zoom).bindings).toContainEqual(TWO_FINGER);
  });

  it('多轮主工具往返后：双指恒命中 Zoom 且各主工具单指命中正确', () => {
    const sequence = [
      ToolNames.pan,
      ToolNames.zoom,
      ToolNames.stackScroll,
      ToolNames.windowLevel,
      null,
    ] as Array<string | null>;
    for (const primary of sequence) {
      syncToolBindings(group, primary);
      const expectedPrimary = primary ?? ToolNames.windowLevel;
      expect(activeToolForTouch(group, 1)).toBe(expectedPrimary);
      expect(activeToolForTouch(group, 2)).toBe(ToolNames.zoom);
    }
    // 终态回归默认
    expect(group.getActivePrimaryMouseButtonTool()).toBe(ToolNames.windowLevel);
    expect(optionOf(group, ToolNames.zoom).bindings).toContainEqual(TWO_FINGER);
    expect(optionOf(group, ToolNames.windowLevel).bindings).toContainEqual({
      mouseButton: Primary,
    });
  });
});
