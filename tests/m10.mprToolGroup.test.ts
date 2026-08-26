/**
 * M10-B MPR ToolGroup 装配（FR-6.2/6.3/6.6）：addTool 先于 setToolActive、
 * 三视口挂载、CrosshairsTool 定位线颜色配置（红=矢状/绿=冠状/黄=轴向）与绑定。
 * 渲染交互 mock 掉，只断言调用链与配置。
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
      addViewport: vi.fn((viewportId: string) => {
        calls.push(`addViewport:${viewportId}`);
      }),
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
  return {
    Enums: {
      MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 },
      KeyboardBindings: { Ctrl: 17 },
    },
    init: vi.fn(),
    addTool: vi.fn(),
    CrosshairsTool: defineTool('Crosshairs'),
    WindowLevelTool: defineTool('WindowLevel'),
    ZoomTool: defineTool('Zoom'),
    PanTool: defineTool('Pan'),
    StackScrollTool: defineTool('StackScroll'),
    ToolGroupManager: {
      createToolGroup: vi.fn((engineId: string) => createFakeToolGroup(engineId)),
      destroyToolGroup: vi.fn(),
    },
  };
});

import { ToolGroupManager } from '@cornerstonejs/tools';
import {
  MPR_REFERENCE_LINE_COLORS,
  createMprToolGroup,
  destroyMprToolGroup,
  initializeMprTools,
  mprToolGroupId,
  planeTint,
} from '../src/features/mpr/mprToolGroup';

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

const MPR_TOOL_ORDER = [
  'WindowLevel',
  'Zoom',
  'Pan',
  'StackScroll',
  'Crosshairs',
];

describe('定位线颜色（医学惯例：红=矢状/绿=冠状/黄=轴向）', () => {
  it('平面 → 颜色映射', () => {
    expect(MPR_REFERENCE_LINE_COLORS).toEqual({
      axial: '#ffff00',
      coronal: '#00ff00',
      sagittal: '#ff0000',
    });
    expect(planeTint('sagittal')).toBe('#ff0000');
    expect(planeTint('coronal')).toBe('#00ff00');
    expect(planeTint('axial')).toBe('#ffff00');
  });
});

describe('createMprToolGroup', () => {
  beforeEach(() => {
    calls.length = 0;
    toolGroups.length = 0;
  });

  it('ToolGroup id 唯一且挂载三平面视口', () => {
    createMprToolGroup('engine-a');
    expect(mprToolGroupId('engine-a')).toBe('engine-a:mpr');
    const group = lastFakeToolGroup();
    expect(group.id).toBe('engine-a:mpr');
    for (const viewportId of ['mpr-axial', 'mpr-coronal', 'mpr-sagittal']) {
      expect(group.addViewport).toHaveBeenCalledWith(viewportId, 'engine-a');
    }
  });

  it('addTool 全部先于任何 setToolActive（Cornerstone 坑）', () => {
    createMprToolGroup('engine-b');
    const addToolCalls = calls.filter((entry) => entry.startsWith('addTool:'));
    expect(addToolCalls).toEqual(MPR_TOOL_ORDER.map((name) => `addTool:${name}`));
    const lastAddTool = calls.lastIndexOf(`addTool:${MPR_TOOL_ORDER[MPR_TOOL_ORDER.length - 1]}`);
    const firstActive = calls.findIndex((entry) => entry.startsWith('setToolActive'));
    expect(lastAddTool).toBeGreaterThan(-1);
    expect(firstActive).toBeGreaterThan(lastAddTool);
  });

  it('CrosshairsTool 携带 getReferenceLineColor 配置（按视口平面配色）', () => {
    createMprToolGroup('engine-c');
    const group = lastFakeToolGroup();
    const addCalls = group.addTool.mock.calls as Array<[string, unknown?]>;
    const crosshairCall = addCalls.find(([name]) => name === 'Crosshairs');
    expect(crosshairCall).toBeDefined();
    const config = crosshairCall?.[1] as {
      getReferenceLineColor: (viewportId: string) => string;
      getReferenceLineControllable: () => boolean;
      getReferenceLineDraggableRotatable: () => boolean;
      getReferenceLineSlabThicknessControlsOn: () => boolean;
    };
    expect(config.getReferenceLineColor('mpr-sagittal')).toBe('#ff0000');
    expect(config.getReferenceLineColor('mpr-coronal')).toBe('#00ff00');
    expect(config.getReferenceLineColor('mpr-axial')).toBe('#ffff00');
    expect(config.getReferenceLineColor('unknown-vp')).toBe('rgb(200, 200, 200)');
    expect(config.getReferenceLineControllable()).toBe(true);
    expect(config.getReferenceLineDraggableRotatable()).toBe(true);
    expect(config.getReferenceLineSlabThicknessControlsOn()).toBe(false);
  });

  it('工具绑定：左键窗宽窗位 / 中键平移 / Ctrl+滚轮缩放 / 滚轮翻层 / 右键十字线', () => {
    createMprToolGroup('engine-d');
    const group = lastFakeToolGroup();
    expect(group.setToolActive).toHaveBeenCalledWith('WindowLevel', {
      bindings: [{ mouseButton: 1 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('Pan', {
      bindings: [{ mouseButton: 4 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('Zoom', {
      bindings: [{ mouseButton: 524288, modifierKey: 17 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('StackScroll', {
      bindings: [{ mouseButton: 524288 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('Crosshairs', {
      bindings: [{ mouseButton: 2 }],
    });
  });

  it('创建失败（null）时抛出明确错误', () => {
    vi.mocked(ToolGroupManager.createToolGroup).mockReturnValueOnce(null as never);
    expect(() => createMprToolGroup('engine-x')).toThrow('创建 MPR ToolGroup 失败');
  });

  it('destroyMprToolGroup 按 id 销毁', () => {
    destroyMprToolGroup('engine-e');
    expect(ToolGroupManager.destroyToolGroup).toHaveBeenCalledWith('engine-e:mpr');
  });
});

describe('initializeMprTools', () => {
  it('注册 CrosshairsTool 到全局工具表且幂等', async () => {
    const tools = await import('@cornerstonejs/tools');
    vi.mocked(tools.init).mockClear();
    vi.mocked(tools.addTool).mockClear();
    await initializeMprTools();
    await initializeMprTools();
    expect(tools.init).toHaveBeenCalledTimes(1);
    expect(tools.addTool).toHaveBeenCalledTimes(1);
    expect(tools.addTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'Crosshairs' }),
    );
  });
});