/**
 * M1 验收缺陷回归测试（ToolGroup 工具挂载与主工具切换）。
 *
 * 背景 1：createBoundToolGroup 此前缺少 toolGroup.addTool(...)，
 * 库内 setToolActive 对未挂载工具静默 return（仅 console.warn），
 * toolOptions 为空 → 事件派发链找不到激活工具，
 * 滚轮翻页/左键窗宽窗位/中键平移全部无响应。
 *
 * 背景 2（本次修复）：setToolActive 会把新 bindings 与旧 bindings 合并
 * （ToolGroup.js: [...prevBindings, ...newBindings] 去重），旧实现切走
 * WindowLevel 时传 bindings:[] 无法清掉 Primary → 事件派发按 addTool
 * 顺序先命中 WindowLevel，缩放/平移/翻层永远表现为窗宽窗位。
 *
 * 本文件 mock @cornerstonejs/tools，验证：
 * 1. 全部 9 个工具（4 常驻 + 5 测量占位）逐个 addTool 进 ToolGroup；
 * 2. addTool 调用严格先于任何 setToolActive；
 * 3. 默认主工具 WindowLevel 以 Primary 绑定激活；
 * 4. 切换主工具后：目标工具持 Primary，原主工具不再含任何鼠标键绑定
 *    （Passive 态），常驻绑定（中键平移/Ctrl+滚轮/滚轮翻页）恒不丢。
 *    行为仿真按库源码 ToolGroup.js 的真实语义建模
 *    （active=merge、passive=剥离 Primary 且剩余绑定时保持 Active）。
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
      setToolPassive: vi.fn((toolName: string) => {
        calls.push(`setToolPassive:${toolName}`);
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
import type { Types } from '@cornerstonejs/tools';
import {
  ALL_TOOL_NAMES,
  MEASUREMENT_TOOLS,
  ToolNames,
  createBoundToolGroup,
  syncToolBindings,
} from '../src/features/viewer/toolSetup';

interface FakeToolGroup {
  id: string;
  addViewport: ReturnType<typeof vi.fn>;
  addTool: ReturnType<typeof vi.fn>;
  setToolActive: ReturnType<typeof vi.fn>;
  setToolPassive: ReturnType<typeof vi.fn>;
}

function lastFakeToolGroup(): FakeToolGroup {
  const group = toolGroups[toolGroups.length - 1];
  if (!group) throw new Error('ToolGroupManager.createToolGroup 未被调用');
  return group as unknown as FakeToolGroup;
}

describe('ALL_TOOL_NAMES', () => {
  it('覆盖 4 个常驻工具与全部测量工具', () => {
    expect(ALL_TOOL_NAMES).toEqual([
      ToolNames.windowLevel,
      ToolNames.zoom,
      ToolNames.pan,
      ToolNames.stackScroll,
      ...MEASUREMENT_TOOLS,
    ]);
    expect(MEASUREMENT_TOOLS).toHaveLength(5);
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

  it('addTool 全部发生在任何 setToolPassive/setToolActive 之前（调用顺序）', () => {
    createBoundToolGroup('engine-b', 'vp-b');

    const firstModeIndex = calls.findIndex((entry) => !entry.startsWith('addTool:'));
    expect(firstModeIndex).toBeGreaterThan(-1);

    // addTool 必须全部先于首个模式调用：否则激活会被静默丢弃
    expect(calls.slice(0, firstModeIndex)).toEqual(
      ALL_TOOL_NAMES.map((name) => `addTool:${name}`),
    );
    const firstModeCall = calls[firstModeIndex] ?? '';
    expect(
      ['setToolPassive:', 'setToolActive:'].some((prefix) =>
        firstModeCall.startsWith(prefix),
      ),
    ).toBe(true);
  });

  it('addViewport 以 (viewportId, renderingEngineId) 调用一次', () => {
    createBoundToolGroup('engine-c', 'vp-c');
    const group = lastFakeToolGroup();
    expect(group.addViewport).toHaveBeenCalledTimes(1);
    expect(group.addViewport).toHaveBeenCalledWith('vp-c', 'engine-c');
  });

  it('同一引擎下多个视口各自创建独立 ToolGroup（id 含 viewportId 且唯一）', () => {
    // 回归缺陷锁：ToolGroupManager 以 id 全局唯一存储，若以共享引擎 id
    // 命名，第二个视口会因重名拿到 undefined → 视口空白。
    vi.mocked(ToolGroupManager.createToolGroup).mockClear();
    createBoundToolGroup('shared-engine', 'vp-0');
    createBoundToolGroup('shared-engine', 'vp-1');
    createBoundToolGroup('shared-engine', 'vp-2');

    expect(ToolGroupManager.createToolGroup).toHaveBeenCalledTimes(3);
    const ids = vi.mocked(ToolGroupManager.createToolGroup).mock.calls.map(
      ([id]) => id,
    );
    expect(ids).toEqual(['shared-engine:vp-0', 'shared-engine:vp-1', 'shared-engine:vp-2']);
    expect(new Set(ids).size).toBe(3);

    // 每个组只挂载自己的视口
    expect((toolGroups[0] as FakeToolGroup).addViewport).toHaveBeenCalledWith(
      'vp-0',
      'shared-engine',
    );
    expect((toolGroups[1] as FakeToolGroup).addViewport).toHaveBeenCalledWith(
      'vp-1',
      'shared-engine',
    );
    expect((toolGroups[2] as FakeToolGroup).addViewport).toHaveBeenCalledWith(
      'vp-2',
      'shared-engine',
    );
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

/**
 * 按 @cornerstonejs/tools 库源码 ToolGroup.js 真实语义建模的状态机
 * （已用真实库探针逐条核对，见 tests/m1.toolsync.integration.test.ts）：
 * - setToolActive：bindings 与旧值合并去重（不清不覆盖），mode=Active；
 * - setToolPassive：默认剥离 Primary 鼠标绑定；若剩余绑定非空则保持 Active。
 * 用它锁定 syncToolBindings 切换后的最终 toolOptions 状态。
 */
interface SimBinding {
  mouseButton: number;
  modifierKey?: string;
}
interface SimToolOption {
  mode: string;
  bindings: SimBinding[];
}
interface SimToolGroup {
  options: Record<string, SimToolOption>;
  addTool(toolName: string): void;
  addViewport(viewportId: string, engineId: string): void;
  setToolActive(toolName: string, opts?: { bindings?: SimBinding[] }): void;
  setToolPassive(toolName: string): void;
}

function createStatefulToolGroup(): SimToolGroup {
  const options: Record<string, SimToolOption> = {};
  const same = (a: SimBinding, b: SimBinding) =>
    a.mouseButton === b.mouseButton && a.modifierKey === b.modifierKey;
  return {
    options,
    addTool(): void {},
    addViewport(): void {},
    setToolActive(toolName: string, opts: { bindings?: SimBinding[] } = {}): void {
      const merged: SimBinding[] = [
        ...(options[toolName]?.bindings ?? []),
        ...(opts.bindings ?? []),
      ].reduce<SimBinding[]>(
        (unique, binding) =>
          unique.some((u) => same(u, binding)) ? unique : [...unique, binding],
        [],
      );
      options[toolName] = { mode: 'Active', bindings: merged };
    },
    setToolPassive(toolName: string): void {
      const kept = (options[toolName]?.bindings ?? []).filter(
        // 默认仅剥离无修饰键的 Primary 绑定（getDefaultPrimaryBindings）
        (binding) =>
          !(
            binding.mouseButton === Enums.MouseBindings.Primary &&
            binding.modifierKey === undefined
          ),
      );
      options[toolName] = {
        mode: kept.length > 0 ? 'Active' : 'Passive',
        bindings: kept,
      };
    },
  };
}

function sync(group: SimToolGroup, primary: string | null): void {
  syncToolBindings(group as unknown as Types.IToolGroup, primary);
}

describe('syncToolBindings 主工具切换（按库语义仿真 toolOptions 终态）', () => {
  const { Primary, Auxiliary, Wheel } = Enums.MouseBindings;
  const CtrlWheel = {
    mouseButton: Enums.MouseBindings.Wheel,
    modifierKey: Enums.KeyboardBindings.Ctrl,
  };

  function optOf(
    group: ReturnType<typeof createStatefulToolGroup>,
    name: string,
  ): SimToolOption {
    const option = group.options[name];
    if (!option) {
      throw new Error(`toolOptions 缺少 ${name}`);
    }
    return option;
  }

  /** 常驻绑定不变式：任意主工具下恒成立 */
  function assertPersistentBindings(group: ReturnType<typeof createStatefulToolGroup>) {
    expect(optOf(group, ToolNames.pan).bindings).toContainEqual({ mouseButton: Auxiliary });
    expect(optOf(group, ToolNames.zoom).bindings).toContainEqual(CtrlWheel);
    expect(optOf(group, ToolNames.stackScroll).bindings).toContainEqual({ mouseButton: Wheel });
  }

  function assertPrimary(group: ReturnType<typeof createStatefulToolGroup>, name: string) {
    const opt = optOf(group, name);
    expect(opt.mode).toBe('Active');
    expect(opt.bindings).toContainEqual({ mouseButton: Primary });
  }

  /** 无 Primary 绑定（pan/zoom/ss 非主工具时仍以常驻绑定保持 Active） */
  function assertNoPrimary(group: ReturnType<typeof createStatefulToolGroup>, name: string) {
    expect(optOf(group, name).bindings).not.toContainEqual({ mouseButton: Primary });
  }

  /** 仅用于 windowLevel：无常驻绑定 → 切走后应为 Passive 且无任何鼠标键 */
  function assertPassiveWithoutMouseBindings(
    group: ReturnType<typeof createStatefulToolGroup>,
    name: string,
  ) {
    const opt = optOf(group, name);
    expect(opt.mode).toBe('Passive');
    expect(opt.bindings.filter((binding) => binding.mouseButton !== undefined)).toEqual([]);
  }

  beforeEach(() => {
    calls.length = 0;
    toolGroups.length = 0;
  });

  it('默认（null → windowLevel）：WindowLevel 拿 Primary，其余仅常驻绑定 Active', () => {
    const group = createStatefulToolGroup();
    sync(group, null);
    assertPrimary(group, ToolNames.windowLevel);
    assertPersistentBindings(group);
    for (const name of [ToolNames.pan, ToolNames.zoom, ToolNames.stackScroll]) {
      expect(optOf(group, name).bindings).not.toContainEqual({ mouseButton: Primary });
    }
  });

  it('切到 pan 后：pan 含 Primary；windowLevel 不含任何鼠标键且为 Passive 态', () => {
    const group = createStatefulToolGroup();
    sync(group, ToolNames.windowLevel);
    sync(group, ToolNames.pan);

    assertPrimary(group, ToolNames.pan);
    assertPassiveWithoutMouseBindings(group, ToolNames.windowLevel);
    assertNoPrimary(group, ToolNames.zoom);
    assertNoPrimary(group, ToolNames.stackScroll);
    assertPersistentBindings(group);

    // 回归缺陷锁：windowLevel 的 bindings 不得残留 Primary（merge 缺陷）
    expect(optOf(group, ToolNames.windowLevel).bindings).not.toContainEqual({
      mouseButton: Primary,
    });
  });

  it('切到 zoom 后同理；stackScroll 恒有滚轮翻页绑定', () => {
    const group = createStatefulToolGroup();
    sync(group, ToolNames.pan);
    sync(group, ToolNames.zoom);

    assertPrimary(group, ToolNames.zoom);
    assertNoPrimary(group, ToolNames.pan);
    assertPassiveWithoutMouseBindings(group, ToolNames.windowLevel);
    assertNoPrimary(group, ToolNames.stackScroll);
    assertPersistentBindings(group);
  });

  it('切到 stackScroll 后再切回 null：恢复 windowLevel 默认且无 Primary 残留', () => {
    const group = createStatefulToolGroup();
    sync(group, ToolNames.stackScroll);
    assertPrimary(group, ToolNames.stackScroll);
    assertNoPrimary(group, ToolNames.zoom);

    sync(group, null);
    assertPrimary(group, ToolNames.windowLevel);
    for (const name of [ToolNames.pan, ToolNames.zoom, ToolNames.stackScroll]) {
      expect(optOf(group, name).bindings).not.toContainEqual({ mouseButton: Primary });
    }
    assertPersistentBindings(group);
  });

  it('1×1→pan→zoom→wl 多轮往返后常驻绑定与唯一主工具恒成立', () => {
    const group = createStatefulToolGroup();
    const sequence: Array<string | null> = [
      ToolNames.pan,
      ToolNames.zoom,
      ToolNames.windowLevel,
      ToolNames.stackScroll,
      ToolNames.pan,
      null,
    ];
    for (const primary of sequence) {
      sync(group, primary);
      assertPersistentBindings(group);
      const primaryHolders = Object.entries(group.options)
        .filter(([, opt]) =>
          opt.bindings.some((binding) => binding.mouseButton === Primary),
        )
        .map(([name]) => name);
      expect(primaryHolders).toHaveLength(1);
    }
    // 终态回到默认
    assertPrimary(group, ToolNames.windowLevel);
  });

  it('对从未激活过的工具切换（首次即非主工具）也不丢常驻绑定', () => {
    // 全新 ToolGroup 直接 sync 到 zoom：pan/ss 从未激活过，
    // passive 后无绑定 → 必须显式重建常驻绑定（否则中键/滚轮失效）
    const group = createStatefulToolGroup();
    sync(group, ToolNames.zoom);
    assertPrimary(group, ToolNames.zoom);
    assertPersistentBindings(group);
  });
});
