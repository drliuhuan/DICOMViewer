/**
 * M10-D 测量工具转正（FR-5.1~5.4）：测量工具可作为左键主工具激活切换，
 * 与窗宽窗位共用同一套 PRexchange PRIMARY 语义，切换后无 Primary 残留。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cornerstonejs/tools', () => {
  function defineTool(name: string) {
    return class {
      static toolName = name;
    };
  }
  return {
    Enums: {
      MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 },
      KeyboardBindings: { Ctrl: 17 },
    },
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
    ToolGroupManager: { createToolGroup: vi.fn(), destroyToolGroup: vi.fn() },
  };
});

import { Enums } from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';
import { MEASUREMENT_TOOLS, ToolNames, syncToolBindings } from '../src/features/viewer/toolSetup';

interface SimBinding {
  mouseButton: number;
  modifierKey?: string;
}
interface SimOption {
  mode: 'Active' | 'Passive';
  bindings: SimBinding[];
}

function createSim() {
  const options: Record<string, SimOption> = {};
  const same = (a: SimBinding, b: SimBinding) =>
    a.mouseButton === b.mouseButton && a.modifierKey === b.modifierKey;
  const group = {
    options,
    addTool() {},
    addViewport() {},
    setToolActive(name: string, opts: { bindings?: SimBinding[] } = {}) {
      const merged = [...(options[name]?.bindings ?? []), ...(opts.bindings ?? [])].reduce<SimBinding[]>(
        (unique, binding) => (unique.some((u) => same(u, binding)) ? unique : [...unique, binding]),
        [],
      );
      options[name] = { mode: 'Active', bindings: merged };
    },
    setToolPassive(name: string) {
      const kept = (options[name]?.bindings ?? []).filter(
        (binding) =>
          !(
            binding.mouseButton === Enums.MouseBindings.Primary &&
            binding.modifierKey === undefined
          ),
      );
      options[name] = { mode: kept.length > 0 ? 'Active' : 'Passive', bindings: kept };
    },
  };
  return group;
}

function primaryHolders(sim: ReturnType<typeof createSim>): string[] {
  return Object.entries(sim.options)
    .filter(([, opt]) => opt.bindings.some((b) => b.mouseButton === Enums.MouseBindings.Primary))
    .map(([name]) => name);
}

describe('测量工具转正（M10-D 解占位）', () => {
  beforeEach(() => {
    // reset module-level nothing（纯函数）
  });

  it('MEASUREMENT_TOOLS 覆盖 5 个测量工具名', () => {
    // M11 任务 3：新增 Cobb 角后为 6 个测量工具（原断言长度同步更新）
    expect(MEASUREMENT_TOOLS).toHaveLength(6);
    expect(MEASUREMENT_TOOLS).toContain(ToolNames.length);
    expect(MEASUREMENT_TOOLS).toContain(ToolNames.angle);
    expect(MEASUREMENT_TOOLS).toContain(ToolNames.rectangleRoi);
    expect(MEASUREMENT_TOOLS).toContain(ToolNames.ellipticalRoi);
    expect(MEASUREMENT_TOOLS).toContain(ToolNames.probe);
  });

  it('切到长度工具：Length 持 Primary，窗宽窗位退出 Primary 但保留中键常驻（M11-F3）', () => {
    const sim = createSim();
    syncToolBindings(sim as unknown as Types.IToolGroup, ToolNames.length);

    expect(sim.options[ToolNames.length]!.mode).toBe('Active');
    expect(sim.options[ToolNames.length]!.bindings).toContainEqual({
      mouseButton: Enums.MouseBindings.Primary,
    });
    // M11-F3：窗宽窗位不再独占 Primary，但中键（Auxiliary）常驻不丢
    expect(sim.options[ToolNames.windowLevel]).toMatchObject({ mode: 'Active' });
    expect(sim.options[ToolNames.windowLevel]!.bindings).toContainEqual({
      mouseButton: Enums.MouseBindings.Auxiliary,
    });
    expect(sim.options[ToolNames.windowLevel]!.bindings).not.toContainEqual({
      mouseButton: Enums.MouseBindings.Primary,
    });
    // 常驻绑定不丢：Ctrl+滚轮缩放 / 滚轮翻页 + 右键翻层（M11-F3）
    expect(sim.options[ToolNames.zoom]!.bindings).toContainEqual({
      mouseButton: Enums.MouseBindings.Wheel,
      modifierKey: Enums.KeyboardBindings.Ctrl,
    });
    expect(sim.options[ToolNames.stackScroll]!.bindings).toContainEqual({
      mouseButton: Enums.MouseBindings.Wheel,
    });
    expect(sim.options[ToolNames.stackScroll]!.bindings).toContainEqual({
      mouseButton: Enums.MouseBindings.Secondary,
    });
    expect(primaryHolders(sim)).toEqual([ToolNames.length]);
  });

  it('角度→矩形→椭圆→窗宽窗位往返：恒唯一主工具', () => {
    const sim = createSim();
    const sequence = [
      ToolNames.angle,
      ToolNames.rectangleRoi,
      ToolNames.ellipticalRoi,
      ToolNames.windowLevel,
    ];
    sequence.forEach((name) => {
      syncToolBindings(sim as unknown as Types.IToolGroup, name);
      expect(primaryHolders(sim)).toHaveLength(1);
    });
    // 终态回到窗宽窗位
    expect(sim.options[ToolNames.windowLevel]!.mode).toBe('Active');
    expect(
      sim.options[ToolNames.rectangleRoi]!.bindings.filter((b) => b.mouseButton !== undefined),
    ).toEqual([]);
  });

  it('测量工具切换不残留 PRIMARY 合并缺陷（回归锁）', () => {
    const sim = createSim();
    syncToolBindings(sim as unknown as Types.IToolGroup, ToolNames.rectangleRoi);
    syncToolBindings(sim as unknown as Types.IToolGroup, ToolNames.ellipticalRoi);
    syncToolBindings(sim as unknown as Types.IToolGroup, null);

    expect(
      sim.options[ToolNames.rectangleRoi]!.bindings.some(
        (b) => b.mouseButton === Enums.MouseBindings.Primary && b.modifierKey === undefined,
      ),
    ).toBe(false);
    // M11-F3：null 回归默认主工具=Pan（左键平移）
    expect(primaryHolders(sim)).toEqual([ToolNames.pan]);
  });
});