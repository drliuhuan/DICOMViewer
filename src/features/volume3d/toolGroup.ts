/**
 * 3D 体绘制视口 ToolGroup 装配（FR-7.1 交互，M10-C；M11-F3 绑定矩阵调整）。
 *
 * 交互默认（cornerstone 内建 camera 控制，可在设置面板调整绑定为 P2）：
 * - 左键（Primary）→ PanTool 平移；
 * - 中键（Auxiliary）→ WindowLevel3DTool 窗宽窗位（M11-F5：WindowLevelTool
 *   子类，拖动中逐帧补发应用级 VOI 变更事件供面板实时跟随；经典
 *   WindowLevelTool 的 setProperties 在部分内核视口架构下不派发
 *   VOI_MODIFIED，见 windowLevel3dTool.ts 根因注释）；
 * - 右键（Secondary）→ TrackballRotateTool 旋转（3D 内建相机轨道旋转）；
 * - 滚轮（Wheel）→ ZoomTool 以光标为心缩放；
 * - OrientationMarkerTool 显示角落方位指示器（轴位朝向立方体）。
 *
 * 与 toolSetup.ts 一致：ToolGroup 必须先 addTool 再 setToolActive
 * （addTool 才把工具实例填入 toolOptions，缺失则 setToolActive 静默失效）。
 */
import {
  Enums,
  OrientationMarkerTool,
  PanTool,
  ToolGroupManager,
  TrackballRotateTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';
import { VOLUME3D_VIEWPORT_ID } from './layout';
import { WindowLevel3DTool } from './windowLevel3dTool';

type Volume3dToolGroup = Types.IToolGroup;

const { MouseBindings } = Enums;

let volume3dToolsInitialized = false;

/** 注册 3D 所需工具到全局工具表（M1 initializeTools 未含，须单独补充）。幂等。 */
export async function initializeVolume3dTools(): Promise<void> {
  if (volume3dToolsInitialized) {
    return;
  }
  const tools = await import('@cornerstonejs/tools');
  tools.init();
  tools.addTool(tools.TrackballRotateTool);
  tools.addTool(tools.OrientationMarkerTool);
  // M11-F3：中键窗宽窗位（3D ToolGroup 此前未注册该工具）
  // M11-F5：改用 WindowLevelTool 子类（拖动中补发 VOI 变更事件）
  tools.addTool(WindowLevel3DTool);
  volume3dToolsInitialized = true;
}

/** 3D ToolGroup 的唯一 id（引擎名 + ':vol3d'） */
export function volume3dToolGroupId(renderingEngineId: string): string {
  return `${renderingEngineId}:vol3d`;
}

/**
 * 创建并装配 3D 视口 ToolGroup。调用前须完成初始化管线与
 * initializeVolume3dTools()（TrackballRotate/OrientationMarker 已入全局表）。
 */
export function createVolume3dToolGroup(
  renderingEngineId: string,
  viewportId: string = VOLUME3D_VIEWPORT_ID,
): Volume3dToolGroup {
  const id = volume3dToolGroupId(renderingEngineId);
  const toolGroup = ToolGroupManager.createToolGroup(id);
  if (!toolGroup) {
    throw new Error(`创建 3D ToolGroup 失败: ${id}`);
  }
  toolGroup.addViewport(viewportId, renderingEngineId);

  // 先 addTool（含 OrientationMarker 方位指示），再 setToolActive（Cornerstone 坑）
  toolGroup.addTool(TrackballRotateTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  // M11-F5：中键调窗换用 WindowLevel3DTool（拖动中实时同步面板）
  toolGroup.addTool(WindowLevel3DTool.toolName);
  toolGroup.addTool(OrientationMarkerTool.toolName);

  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Primary }],
  });
  toolGroup.setToolActive(WindowLevel3DTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Auxiliary }],
  });
  toolGroup.setToolActive(TrackballRotateTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Secondary }],
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }],
  });
  // OrientationMarkerTool 为显示型工具：无按钮绑定，active 后持续渲染方位指示
  toolGroup.setToolActive(OrientationMarkerTool.toolName);
  return toolGroup;
}

/** 销毁 3D ToolGroup（退出 3D 时调用） */
export function destroyVolume3dToolGroup(renderingEngineId: string): void {
  ToolGroupManager.destroyToolGroup(volume3dToolGroupId(renderingEngineId));
}