/**
 * 真实库集成回归：用未 mock 的 @cornerstonejs/tools ToolGroup
 * 锁定「主工具切换真正生效」的验收语义。
 *
 * 库内关键行为（ToolGroup.js，探针逐条核对）：
 * - setToolActive 把新 bindings 与旧 bindings 合并去重 → 无法用它清绑定；
 * - setToolPassive 默认剥离 Primary 绑定，剩余绑定非空时保持 Active；
 * - getActiveToolForMouseEvent 按 addTool 顺序遍历 toolOptions，
 *   返回第一个 mode=Active 且 bindings 命中鼠标键+修饰键的工具。
 *
 * 不调用 addViewport（node 环境无 WebGL/DOM）：viewportsInfo 保持为空，
 * 库内光标设置与 _renderViewports 均为空遍历，不影响 toolOptions 状态；
 * addViewport 本身的调用契约已由 m1.toolgroup.test.ts 覆盖。
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

const { Primary, Auxiliary, Wheel } = Enums.MouseBindings;
const CtrlWheel = {
  mouseButton: Wheel,
  modifierKey: Enums.KeyboardBindings.Ctrl,
};

/** 与 createBoundToolGroup 相同的挂载流程，但跳过 addViewport（无渲染环境） */
function createStatefulRealToolGroup(): Types.IToolGroup {
  const group = ToolGroupManager.createToolGroup('it-engine');
  if (!group) {
    throw new Error('创建 ToolGroup 失败: it-engine/vp-it');
  }
  for (const toolName of ALL_TOOL_NAMES) {
    group.addTool(toolName);
  }
  syncToolBindings(group, ToolNames.windowLevel);
  return group;
}

interface ToolOption {
  mode: string;
  bindings: Array<Record<string, unknown>>;
}

function optOf(group: Types.IToolGroup, name: string): ToolOption {
  const options = group.toolOptions as unknown as Record<string, ToolOption | undefined>;
  const option = options[name];
  if (!option) {
    throw new Error(`toolOptions 缺少 ${name}`);
  }
  return option;
}

/** 无任何鼠标键绑定（windowLevel 切走后的验收形态） */
function assertNoMouseBinding(option: ToolOption): void {
  expect(option.mode).toBe('Passive');
  expect(option.bindings.filter((binding) => binding.mouseButton !== undefined)).toEqual([]);
}

describe('syncToolBindings × 真实 ToolGroup', () => {
  let group: Types.IToolGroup;

  beforeEach(async () => {
    await initializeTools();
    if (group) {
      destroyBoundToolGroup(group);
    }
    group = createStatefulRealToolGroup();
  });

  it('默认：windowLevel Active 含 Primary；pan/zoom/ss 各持常驻绑定 Active', () => {
    expect(optOf(group, ToolNames.windowLevel).mode).toBe('Active');
    expect(optOf(group, ToolNames.windowLevel).bindings).toContainEqual({ mouseButton: Primary });
    expect(optOf(group, ToolNames.pan).bindings).toContainEqual({ mouseButton: Auxiliary });
    expect(optOf(group, ToolNames.zoom).bindings).toContainEqual(CtrlWheel);
    expect(optOf(group, ToolNames.stackScroll).bindings).toContainEqual({ mouseButton: Wheel });
    expect(group.getActivePrimaryMouseButtonTool()).toBe(ToolNames.windowLevel);
  });

  it('切到 pan 后：pan 含 Primary；windowLevel Passive 且无任何鼠标键绑定（缺陷锁）', () => {
    syncToolBindings(group, ToolNames.pan);

    const pan = optOf(group, ToolNames.pan);
    expect(pan.mode).toBe('Active');
    expect(pan.bindings).toContainEqual({ mouseButton: Primary });
    // 中键平移常驻绑定不丢
    expect(pan.bindings).toContainEqual({ mouseButton: Auxiliary });

    // 缺陷锁：windowLevel 不再残留 Primary，派发循环不可能先命中它
    assertNoMouseBinding(optOf(group, ToolNames.windowLevel));

    // 缩放/翻层常驻绑定不丢且仍 Active
    const zoom = optOf(group, ToolNames.zoom);
    expect(zoom.mode).toBe('Active');
    expect(zoom.bindings).toContainEqual(CtrlWheel);
    const stackScroll = optOf(group, ToolNames.stackScroll);
    expect(stackScroll.mode).toBe('Active');
    expect(stackScroll.bindings).toContainEqual({ mouseButton: Wheel });

    // 派发视角：按库匹配规则 Primary 只会命中 pan
    expect(group.getActivePrimaryMouseButtonTool()).toBe(ToolNames.pan);
  });

  it('切到 zoom 后同理：zoom 持 Primary，pan/ss 仅常驻绑定', () => {
    syncToolBindings(group, ToolNames.zoom);

    expect(optOf(group, ToolNames.zoom).bindings).toContainEqual({ mouseButton: Primary });
    expect(optOf(group, ToolNames.zoom).bindings).toContainEqual(CtrlWheel);
    assertNoMouseBinding(optOf(group, ToolNames.windowLevel));
    expect(optOf(group, ToolNames.pan).bindings).not.toContainEqual({ mouseButton: Primary });
    expect(optOf(group, ToolNames.pan).bindings).toContainEqual({ mouseButton: Auxiliary });
    expect(optOf(group, ToolNames.stackScroll).bindings).toContainEqual({ mouseButton: Wheel });
    expect(group.getActivePrimaryMouseButtonTool()).toBe(ToolNames.zoom);
  });

  it('切回 null 恢复默认；全程恰有一个工具持 Primary 且常驻绑定恒在', () => {
    const sequence = [
      ToolNames.pan,
      ToolNames.zoom,
      ToolNames.stackScroll,
      null,
    ] as Array<string | null>;

    for (const primary of sequence) {
      syncToolBindings(group, primary);
      const primaryHolders = Object.entries(
        group.toolOptions as unknown as Record<string, ToolOption>,
      )
        .filter(([, option]) =>
          option.bindings.some((binding) => binding.mouseButton === Primary),
        )
        .map(([name]) => name);
      expect(primaryHolders).toEqual([primary ?? ToolNames.windowLevel]);
      expect(optOf(group, ToolNames.pan).bindings).toContainEqual({ mouseButton: Auxiliary });
      expect(optOf(group, ToolNames.zoom).bindings).toContainEqual(CtrlWheel);
      expect(optOf(group, ToolNames.stackScroll).bindings).toContainEqual({ mouseButton: Wheel });
    }

    // 终态 = 出厂默认
    expect(optOf(group, ToolNames.windowLevel).mode).toBe('Active');
    expect(group.getActivePrimaryMouseButtonTool()).toBe(ToolNames.windowLevel);
  });
});
