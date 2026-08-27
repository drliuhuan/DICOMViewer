/**
 * M10-C 3D ToolGroup 装配（FR-7.1 交互；M11-F3 绑定矩阵）：
 * 左键平移/中键调窗/右键旋转/滚轮缩放 + OrientationMarker 方位指示；
 * addTool 先于 setToolActive；幂等注册（含 M11-F3 新增 WindowLevelTool）。
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
      setToolPassive: vi.fn(),
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
    TrackballRotateTool: defineTool('TrackballRotate'),
    PanTool: defineTool('Pan'),
    ZoomTool: defineTool('Zoom'),
    WindowLevelTool: defineTool('WindowLevel'),
    OrientationMarkerTool: defineTool('OrientationMarker'),
    ToolGroupManager: {
      createToolGroup: vi.fn((engineId: string) => createFakeToolGroup(engineId)),
      destroyToolGroup: vi.fn(),
    },
  };
});

import { ToolGroupManager } from '@cornerstonejs/tools';
import {
  createVolume3dToolGroup,
  destroyVolume3dToolGroup,
  initializeVolume3dTools,
  volume3dToolGroupId,
} from '../src/features/volume3d/toolGroup';

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

const VOL3D_TOOL_ORDER = ['TrackballRotate', 'Pan', 'Zoom', 'WindowLevel', 'OrientationMarker'];

describe('createVolume3dToolGroup（FR-7.1 交互）', () => {
  beforeEach(() => {
    calls.length = 0;
    toolGroups.length = 0;
  });

  it('ToolGroup id 唯一且挂载 vol3d-main 视口', () => {
    createVolume3dToolGroup('engine-a');
    expect(volume3dToolGroupId('engine-a')).toBe('engine-a:vol3d');
    const group = lastFakeToolGroup();
    expect(group.id).toBe('engine-a:vol3d');
    expect(group.addViewport).toHaveBeenCalledWith('vol3d-main', 'engine-a');
  });

  it('addTool 全部先于任何 setToolActive（Cornerstone 坑）', () => {
    createVolume3dToolGroup('engine-b');
    const addToolCalls = calls.filter((entry) => entry.startsWith('addTool:'));
    expect(addToolCalls).toEqual(VOL3D_TOOL_ORDER.map((name) => `addTool:${name}`));
    const lastAddTool = calls.lastIndexOf(
      `addTool:${VOL3D_TOOL_ORDER[VOL3D_TOOL_ORDER.length - 1]}`,
    );
    const firstActive = calls.findIndex((entry) => entry.startsWith('setToolActive'));
    expect(lastAddTool).toBeGreaterThan(-1);
    expect(firstActive).toBeGreaterThan(lastAddTool);
  });

  it('绑定默认（M11-F3 矩阵）：左键平移、中键调窗、右键旋转、滚轮缩放', () => {
    createVolume3dToolGroup('engine-c');
    const group = lastFakeToolGroup();
    expect(group.setToolActive).toHaveBeenCalledWith('Pan', {
      bindings: [{ mouseButton: 1 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('WindowLevel', {
      bindings: [{ mouseButton: 4 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('TrackballRotate', {
      bindings: [{ mouseButton: 2 }],
    });
    expect(group.setToolActive).toHaveBeenCalledWith('Zoom', {
      bindings: [{ mouseButton: 524288 }],
    });
    // OrientationMarker 显示型工具：active 但无按钮绑定
    const markerCall = group.setToolActive.mock.calls.find(
      ([name]) => name === 'OrientationMarker',
    );
    expect(markerCall).toBeDefined();
  });

  it('创建失败（null）时抛出明确错误', () => {
    vi.mocked(ToolGroupManager.createToolGroup).mockReturnValueOnce(null as never);
    expect(() => createVolume3dToolGroup('engine-x')).toThrow('创建 3D ToolGroup 失败');
  });

  it('destroyVolume3dToolGroup 按 id 销毁', () => {
    destroyVolume3dToolGroup('engine-e');
    expect(ToolGroupManager.destroyToolGroup).toHaveBeenCalledWith('engine-e:vol3d');
  });
});

describe('initializeVolume3dTools', () => {
  it('注册 TrackballRotate / OrientationMarker / WindowLevel 到全局工具表且幂等', async () => {
    const tools = await import('@cornerstonejs/tools');
    vi.mocked(tools.init).mockClear();
    vi.mocked(tools.addTool).mockClear();
    await initializeVolume3dTools();
    await initializeVolume3dTools();
    expect(tools.init).toHaveBeenCalledTimes(1);
    // M11-F3：TrackballRotate + OrientationMarker + WindowLevel = 3 个
    expect(tools.addTool).toHaveBeenCalledTimes(3);
    expect(tools.addTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'TrackballRotate' }),
    );
    expect(tools.addTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'OrientationMarker' }),
    );
    expect(tools.addTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'WindowLevel' }),
    );
  });
});