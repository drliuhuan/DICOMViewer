/**
 * M1 验收缺陷回归测试（ToolGroup 工具挂载）。
 *
 * 背景：createBoundToolGroup 此前缺少 toolGroup.addTool(...)，
 * 库内 setToolActive 对未挂载工具静默 return（仅 console.warn），
 * toolOptions 为空 → 事件派发链找不到激活工具，
 * 滚轮翻页/左键窗宽窗位/中键平移全部无响应。
 *
 * 本文件 mock @cornerstonejs/tools，验证：
 * 1. 全部 9 个工具（4 常驻 + 5 测量占位）逐个 addTool 进 ToolGroup；
 * 2. addTool 调用严格先于任何 setToolActive；
 * 3. 默认主工具 WindowLevel 仍以 Primary 绑定激活。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, toolGroups } = vi.hoisted(() => ({
  calls: [] as string[],
  toolGroups: [] as unknown[],
}));

vi.mock('@cornerstonejs/tools', () => {
  function defineTool(name: string) {
    return class {
      static toolName = name;
    };
  }

  function createFakeToolGroup(id: string) {
    const group = {
      id,
      addViewport: vi.fn(),
      addTool: vi.fn((toolName: string) => {
        calls.push(`addTool:${toolName}`);
      }),
      setToolActive: vi.fn((toolName: string) => {
        calls.push(`setToolActive:${toolName}`);
      }),
    };
    toolGroups.push(group);
    return group;
  }

  const ToolGroupManager = {
    createToolGroup: vi.fn((engineId: string) => createFakeToolGroup(engineId)),
    destroyToolGroup: vi.fn(),
  };

  const MouseBindings = { Primary: 1, Auxiliary: 4, Wheel: 524288 };
  const KeyboardBindings = { Ctrl: 'ctrl' };

  return {
    Enums: { MouseBindings, KeyboardBindings },
    init: vi.fn(),
    addTool: vi.fn(),
    WindowLevelTool: defineTool('WindowLevel'),
    ZoomTool: defineTool('Zoom'),
    PanTool: defineTool('Pan'),
    StackScrollTool: defineTool('StackScroll'),
    LengthTool: defineTool('Length'),
    AngleTool: defineTool('Angle'),
    RectangleROITool: defineTool('RectangleROI'),
    EllipticalROITool: defineTool('EllipticalROI'),
    ProbeTool: defineTool('Probe'),
    ToolGroupManager,
  };
});

import { Enums, ToolGroupManager } from '@cornerstonejs/tools';
import {
  ALL_TOOL_NAMES,
  PLACEHOLDER_MEASUREMENT_TOOLS,
  ToolNames,
  createBoundToolGroup,
} from '../src/features/viewer/toolSetup';

interface FakeToolGroup {
  id: string;
  addViewport: ReturnType<typeof vi.fn>;
  addTool: ReturnType<typeof vi.fn>;
  setToolActive: ReturnType<typeof vi.fn>;
}

function lastFakeToolGroup(): FakeToolGroup {
  const group = toolGroups[toolGroups.length - 1];
  if (!group) throw new Error('ToolGroupManager.createToolGroup 未被调用');
  return group as unknown as FakeToolGroup;
}

describe('ALL_TOOL_NAMES', () => {
  it('覆盖 4 个常驻工具与全部测量占位工具', () => {
    expect(ALL_TOOL_NAMES).toEqual([
      ToolNames.windowLevel,
      ToolNames.zoom,
      ToolNames.pan,
      ToolNames.stackScroll,
      ...PLACEHOLDER_MEASUREMENT_TOOLS,
    ]);
    expect(PLACEHOLDER_MEASUREMENT_TOOLS).toHaveLength(5);
    expect(ALL_TOOL_NAMES).toHaveLength(9);
  });
});

describe('createBoundToolGroup', () => {
  beforeEach(() => {
    calls.length = 0;
    toolGroups.length = 0;
  });

  it('对每个已注册工具调用过 toolGroup.addTool(name)', () => {
    createBoundToolGroup('engine-a', 'vp-a');
    expect(ToolGroupManager.createToolGroup).toHaveBeenCalledTimes(1);

    const group = lastFakeToolGroup();
    for (const name of ALL_TOOL_NAMES) {
      expect(group.addTool).toHaveBeenCalledWith(name);
    }
    expect(group.addTool).toHaveBeenCalledTimes(ALL_TOOL_NAMES.length);
  });

  it('addTool 全部发生在任何 setToolActive 之前（调用顺序）', () => {
    createBoundToolGroup('engine-b', 'vp-b');

    const firstActiveIndex = calls.findIndex((entry) =>
      entry.startsWith('setToolActive:'),
    );
    expect(firstActiveIndex).toBeGreaterThan(-1);

    // addTool 必须全部先于首个 setToolActive：否则激活会被静默丢弃
    expect(calls.slice(0, firstActiveIndex)).toEqual(
      ALL_TOOL_NAMES.map((name) => `addTool:${name}`),
    );
  });

  it('addViewport 以 (viewportId, renderingEngineId) 调用一次', () => {
    createBoundToolGroup('engine-c', 'vp-c');
    const group = lastFakeToolGroup();
    expect(group.addViewport).toHaveBeenCalledTimes(1);
    expect(group.addViewport).toHaveBeenCalledWith('vp-c', 'engine-c');
  });

  it('默认主工具 WindowLevel 以 Primary 绑定保持 Active（回归保护）', () => {
    createBoundToolGroup('engine-d', 'vp-d');
    const group = lastFakeToolGroup();
    expect(group.setToolActive).toHaveBeenCalledWith(ToolNames.windowLevel, {
      bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
    });
  });

  it('创建失败（null）时抛出明确错误', () => {
    vi.mocked(ToolGroupManager.createToolGroup).mockReturnValueOnce(null as never);
    expect(() => createBoundToolGroup('engine-x', 'vp-x')).toThrow(
      '创建 ToolGroup 失败: engine-x/vp-x',
    );
  });
});
