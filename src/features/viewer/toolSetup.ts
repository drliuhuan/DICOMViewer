/**
 * @cornerstonejs/tools 集成（M1，FR-3.2/3.5/3.6/3.7）。
 *
 * 绑定方案（遵循主流阅片软件惯例，FR-3.7 默认滚轮=翻页）：
 * - WindowLevelTool  左键拖动调节窗宽窗位（默认主工具）
 * - PanTool          中键(Auxiliary)拖动平移；亦可作为左键主工具激活
 * - ZoomTool         Ctrl+滚轮 以光标为中心缩放；亦可作为左键主工具激活
 * - StackScrollTool  滚轮翻页（无修饰键）；作为左键主工具激活时拖动翻层
 *
 * 四个工具常驻 Active，各自持有互不冲突的绑定组合；
 * 切换「主工具」只是把 Primary 按钮重新分配给目标工具。
 *
 * 测量类工具（Length/Angle/RectangleROI/EllipticalROI/Probe）仅注册占位：
 * 激活入口由 UI 层拦截并提示「M3 提供」，避免快捷键体系返工。
 */
import {
  AngleTool,
  EllipticalROITool,
  LengthTool,
  PanTool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
  Enums,
  addTool,
} from '@cornerstonejs/tools';
import type { Types } from '@cornerstonejs/tools';

type ToolGroup = Types.IToolGroup;
type ToolBinding = Types.IToolBinding;

const { MouseBindings, KeyboardBindings } = Enums;

/** 已注册的工具名（与各 ToolClass.toolName 一致） */
export const ToolNames = {
  windowLevel: WindowLevelTool.toolName,
  zoom: ZoomTool.toolName,
  pan: PanTool.toolName,
  stackScroll: StackScrollTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  rectangleRoi: RectangleROITool.toolName,
  ellipticalRoi: EllipticalROITool.toolName,
  probe: ProbeTool.toolName,
} as const;

export type PrimaryDragTool =
  | typeof ToolNames.windowLevel
  | typeof ToolNames.zoom
  | typeof ToolNames.pan
  | typeof ToolNames.stackScroll;

/** M3 占位测量工具（本阶段激活仅提示，不真正启用交互） */
export const PLACEHOLDER_MEASUREMENT_TOOLS: readonly string[] = [
  ToolNames.length,
  ToolNames.angle,
  ToolNames.rectangleRoi,
  ToolNames.ellipticalRoi,
  ToolNames.probe,
];

/** 左键可切换的「主」工具集合 */
const PRIMARY_DRAG_TOOLS: readonly string[] = [
  ToolNames.windowLevel,
  ToolNames.zoom,
  ToolNames.pan,
  ToolNames.stackScroll,
];

/** 各工具的常驻绑定（不随主工具切换而丢失） */
const PERSISTENT_BINDINGS: Readonly<Record<string, readonly ToolBinding[]>> = {
  [ToolNames.pan]: [{ mouseButton: MouseBindings.Auxiliary }],
  [ToolNames.zoom]: [
    { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl },
  ],
  [ToolNames.stackScroll]: [{ mouseButton: MouseBindings.Wheel }],
};

let toolsReadyPromise: Promise<void> | null = null;

/** 全局注册内置工具类 + 初始化 tools 内部监听；幂等。 */
export function initializeTools(): Promise<void> {
  toolsReadyPromise ??= (async () => {
    const { init } = await import('@cornerstonejs/tools');
    init();
    addTool(WindowLevelTool);
    addTool(ZoomTool);
    addTool(PanTool);
    addTool(StackScrollTool);
    // M3 测量占位：先注册保证名称存在与快捷键体系兼容
    addTool(LengthTool);
    addTool(AngleTool);
    addTool(RectangleROITool);
    addTool(EllipticalROITool);
    addTool(ProbeTool);
  })();
  return toolsReadyPromise;
}

/**
 * 为视口创建 ToolGroup 并应用默认绑定（主工具=窗宽窗位）。
 * 调用前须完成 initializeTools()。
 */
export function createBoundToolGroup(
  renderingEngineId: string,
  viewportId: string,
): ToolGroup {
  const toolGroup = ToolGroupManager.createToolGroup(renderingEngineId);
  if (!toolGroup) {
    throw new Error(`创建 ToolGroup 失败: ${renderingEngineId}/${viewportId}`);
  }
  toolGroup.addViewport(viewportId, renderingEngineId);
  syncToolBindings(toolGroup, ToolNames.windowLevel);
  return toolGroup;
}

/**
 * 将 Primary 鼠标按钮分配给指定主工具，并同步全部四个常驻工具的绑定。
 * @param primary 目标主工具名；传 null 视为恢复默认（窗宽窗位）
 */
export function syncToolBindings(
  toolGroup: ToolGroup,
  primary: string | null,
): void {
  const activeTool = primary ?? ToolNames.windowLevel;
  for (const toolName of PRIMARY_DRAG_TOOLS) {
    const bindings = [
      ...(toolName === activeTool
        ? [{ mouseButton: MouseBindings.Primary }]
        : []),
      ...(PERSISTENT_BINDINGS[toolName] ?? []),
    ];
    // 全部保持 Active：未持绑定的工具不会响应任何输入
    toolGroup.setToolActive(toolName, { bindings });
  }
}

/** 销毁 ToolGroup（视口卸载时调用，防泄漏）。 */
export function destroyBoundToolGroup(toolGroup: ToolGroup): void {
  ToolGroupManager.destroyToolGroup(toolGroup.id);
}
