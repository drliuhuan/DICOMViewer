/**
 * MPR 三平面 ToolGroup 装配（FR-6.2/6.3/6.6，M10-B）。
 *
 * - 一个 ToolGroup 挂载轴向/冠状/矢状三视口，CrosshairsTool 以
 *   Secondary（右键）拖动定位线联动：拖线移动交心，三平面实时更新；
 * - 基础操作继承（FR-6.6）：左键窗宽窗位 / 中键平移 / Ctrl+滚轮缩放 /
 *   滚轮翻层，与 2D ViewerCell 工具绑定语义一致；
 * - 定位线颜色遵循医学惯例：红=矢状参考、绿=冠状、黄=轴向。
 *   CrosshairsTool 渲染时按「另一视口」的 getReferenceLineColor 上色，
 *   因此三视口各自看到的线色即对应平面的参考色（轴向视口可见红+绿线等）。
 *
 * 与 toolSetup.ts 一致：ToolGroup 必须先 addTool 再 setToolActive
 * （addTool 把工具实例填入 toolOptions，缺失则 setToolActive 静默失效）。
 * ToolGroup id 必须是引擎级唯一（既有注释强调）。
 */
import {
  CrosshairsTool,
  Enums,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  PanTool,
  StackScrollTool,
} from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';
import { MPR_VIEWPORT_IDS, planeForViewportId } from './mprLayout';
import type { MprPlaneKey } from './mprLayout';

type MprToolGroup = Types.IToolGroup;

/** 定位线颜色（医学惯例：红=矢状参考 / 绿=冠状 / 黄=轴向） */
export const MPR_REFERENCE_LINE_COLORS: Readonly<Record<MprPlaneKey, string>> = {
  axial: '#ffff00',
  coronal: '#00ff00',
  sagittal: '#ff0000',
};

/** MPR 平面右上角角标色（与定位线同色系） */
export function planeTint(plane: MprPlaneKey): string {
  return MPR_REFERENCE_LINE_COLORS[plane];
}

let mprToolsInitialized = false;

/**
 * 注册 CrosshairsTool 到全局工具表（M1 initializeTools 未含，须单独补充）。
 * 幂等：仅首次真正 addTool，避免库内重复注册告警。
 */
export async function initializeMprTools(): Promise<void> {
  if (mprToolsInitialized) {
    return;
  }
  const tools = await import('@cornerstonejs/tools');
  tools.init();
  tools.addTool(tools.CrosshairsTool);
  mprToolsInitialized = true;
}

const { MouseBindings, KeyboardBindings } = Enums;

/** MPR ToolGroup 的唯一 id（引擎名 + ':mpr'） */
export function mprToolGroupId(renderingEngineId: string): string {
  return `${renderingEngineId}:mpr`;
}

/**
 * 创建并装配三平面 ToolGroup。调用前须完成 initializeTools() 与
 * initializeMprTools()（CrosshairsTool 注册到全局工具表）。
 */
export function createMprToolGroup(
  renderingEngineId: string,
  viewportIds: readonly string[] = MPR_VIEWPORT_IDS,
): MprToolGroup {
  const id = mprToolGroupId(renderingEngineId);
  const toolGroup = ToolGroupManager.createToolGroup(id);
  if (!toolGroup) {
    throw new Error(`创建 MPR ToolGroup 失败: ${id}`);
  }
  toolGroup.addViewport(viewportIds[0]!, renderingEngineId);
  toolGroup.addViewport(viewportIds[1]!, renderingEngineId);
  toolGroup.addViewport(viewportIds[2]!, renderingEngineId);

  // 先 addTool（含 CrosshairsTool 配置），再 setToolActive（Cornerstone 坑）
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(StackScrollTool.toolName);
  toolGroup.addTool(CrosshairsTool.toolName, {
    getReferenceLineColor: (targetViewportId: string) => {
      const plane = planeForViewportId(targetViewportId);
      return plane !== null ? MPR_REFERENCE_LINE_COLORS[plane] : 'rgb(200, 200, 200)';
    },
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => true,
    getReferenceLineSlabThicknessControlsOn: () => false,
  });

  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Primary }],
  });
  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Auxiliary }],
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [
      { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl },
    ],
  });
  toolGroup.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }],
  });
  toolGroup.setToolActive(CrosshairsTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Secondary }],
  });
  return toolGroup;
}

/** 销毁 MPR ToolGroup（退出 MPR 时调用） */
export function destroyMprToolGroup(renderingEngineId: string): void {
  ToolGroupManager.destroyToolGroup(mprToolGroupId(renderingEngineId));
}