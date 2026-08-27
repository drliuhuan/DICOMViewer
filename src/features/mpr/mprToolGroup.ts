/**
 * MPR 三平面 ToolGroup 装配（FR-6.2/6.3/6.6，M10-B；M11-F3 绑定矩阵调整）。
 *
 * - 一个 ToolGroup 挂载轴向/冠状/矢状三视口，CrosshairsTool 负责定位线
 *   联动：M11-F3 起纳入「可切换主工具」机制（方案 a）——默认主工具为
 *   Pan，工具栏「定位线」按钮激活后左键拖线移动交心，三平面实时更新；
 *   非主工具态（Passive）定位线仍渲染并随相机联动，只是不响应拖动；
 * - 基础操作继承（FR-6.6，与 2D 一致的新矩阵）：左键平移（默认主工具）/
 *   中键窗宽窗位（常驻）/ 右键滚层 + 滚轮翻层 / Ctrl+滚轮缩放；
 * - 定位线颜色遵循医学惯例：红=矢状参考、绿=冠状、黄=轴向。
 *   CrosshairsTool 渲染时按「另一视口」的 getReferenceLineColor 上色，
 *   因此三视口各自看到的线色即对应平面的参考色（轴向视口可见红+绿线等）。
 *
 * 与 toolSetup.ts 一致：ToolGroup 必须先 addTool 再 setToolActive
 * （addTool 把工具实例填入 toolOptions，缺失则 setToolActive 静默失效）。
 * ToolGroup id 必须是引擎级唯一（既有注释强调）。
 */
import {
  AngleTool,
  CrosshairsTool,
  EllipticalROITool,
  Enums,
  LengthTool,
  PanTool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';
import { MPR_VIEWPORT_IDS, planeForViewportId } from './mprLayout';
import type { MprPlaneKey } from './mprLayout';

type MprToolGroup = Types.IToolGroup;
type ToolBinding = Types.IToolBinding;

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
  // M10-D FR-5.15：MPR 三视口同样支持长度/角度/矩形/椭圆测量（复用同一套工具）
  toolGroup.addTool(LengthTool.toolName);
  toolGroup.addTool(AngleTool.toolName);
  toolGroup.addTool(RectangleROITool.toolName);
  toolGroup.addTool(EllipticalROITool.toolName);
  toolGroup.addTool(ProbeTool.toolName);
  toolGroup.addTool(CrosshairsTool.toolName, {
    getReferenceLineColor: (targetViewportId: string) => {
      const plane = planeForViewportId(targetViewportId);
      return plane !== null ? MPR_REFERENCE_LINE_COLORS[plane] : 'rgb(200, 200, 200)';
    },
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => true,
    getReferenceLineSlabThicknessControlsOn: () => false,
  });

  // 绑定矩阵唯一来源：与主工具切换共用同一套装配逻辑（默认主工具=Pan）
  syncMprToolBindings(toolGroup, MPR_DEFAULT_PRIMARY_TOOL);
  return toolGroup;
}

/** 可切换为「主工具」的 MPR 工具（左键 Primary；含测量 FR-5.15 与 Crosshairs） */
export const MPR_PRIMARY_SELECTABLE_TOOLS: readonly string[] = [
  WindowLevelTool.toolName,
  ZoomTool.toolName,
  PanTool.toolName,
  StackScrollTool.toolName,
  LengthTool.toolName,
  AngleTool.toolName,
  RectangleROITool.toolName,
  EllipticalROITool.toolName,
  ProbeTool.toolName,
  CrosshairsTool.toolName,
];

/** MPR 默认主工具（左键基础交互）：平移（M11-F3，原为窗宽窗位） */
export const MPR_DEFAULT_PRIMARY_TOOL: string = PanTool.toolName;

/** MPR 定位线工具名（工具栏「定位线」按钮的切换目标） */
export const MPR_CROSSHAIRS_TOOL: string = CrosshairsTool.toolName;

/**
 * 各工具常驻绑定（不随主工具切换丢失；M11-F3 矩阵：
 * 中键=窗宽窗位常驻、右键+滚轮=翻层、Ctrl+滚轮=缩放；
 * Pan/Crosshairs 仅在作为主工具时持 Primary，无常驻绑定）。
 */
const MPR_PERSISTENT_BINDINGS: Readonly<Record<string, readonly ToolBinding[]>> = {
  [WindowLevelTool.toolName]: [{ mouseButton: MouseBindings.Auxiliary }],
  [ZoomTool.toolName]: [
    { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl },
  ],
  [StackScrollTool.toolName]: [
    { mouseButton: MouseBindings.Wheel },
    { mouseButton: MouseBindings.Secondary },
  ],
};

/**
 * 切换 MPR 三视口的左键主工具（FR-5.15 测量 / FR-6.6 窗宽窗位 /
 * M11-F3 Crosshairs 定位线）。与 2D toolSetup.syncToolBindings 同一套
 * 「先 setToolPassive 剥离 Primary，再按目标重建」语义；默认主工具=Pan。
 * Crosshairs 非主工具时落回 Passive（定位线渲染/相机联动保留，拖动关闭）。
 */
export function syncMprToolBindings(
  toolGroup: MprToolGroup,
  primary: string | null,
): void {
  const activeTool = primary ?? MPR_DEFAULT_PRIMARY_TOOL;
  for (const toolName of MPR_PRIMARY_SELECTABLE_TOOLS) {
    toolGroup.setToolPassive(toolName);
    const bindings =
      toolName === activeTool
        ? [{ mouseButton: MouseBindings.Primary }, ...(MPR_PERSISTENT_BINDINGS[toolName] ?? [])]
        : [...(MPR_PERSISTENT_BINDINGS[toolName] ?? [])];
    if (bindings.length > 0) {
      toolGroup.setToolActive(toolName, { bindings });
    }
  }
}

/** 销毁 MPR ToolGroup（退出 MPR 时调用） */
export function destroyMprToolGroup(renderingEngineId: string): void {
  ToolGroupManager.destroyToolGroup(mprToolGroupId(renderingEngineId));
}