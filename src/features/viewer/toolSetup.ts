/**
 * @cornerstonejs/tools 集成（M1，FR-3.2/3.5/3.6/3.7）。
 *
 * 绑定方案（遵循主流阅片软件惯例，FR-3.7 默认滚轮=翻页）：
 * - WindowLevelTool  左键拖动调节窗宽窗位（默认主工具）
 * - PanTool          中键(Auxiliary)拖动平移；亦可作为左键主工具激活
 * - ZoomTool         Ctrl+滚轮 以光标为中心缩放；亦可作为左键主工具激活
 * - StackScrollTool  滚轮翻页（无修饰键）；作为左键主工具激活时拖动翻层
 *
 * 切换「主工具」= 把 Primary 按钮分配给目标工具，其余工具退出 Primary：
 * 主工具 Active（Primary + 常驻绑定），其余三个仅保留各自互不冲突的
 * 常驻绑定（中键平移/Ctrl+滚轮缩放/滚轮翻页），见 syncToolBindings。
 *
 * 测量类工具（Length/Angle/RectangleROI/EllipticalROI/Probe）已由 M10-D 转正：
 * 可作为左键主工具激活（点击工具栏「长度/角度/矩形/椭圆」或快捷键
 * L/A/R/O），激活后左键划线/拖动 ROI；主工具切换逻辑与窗宽窗位等一致。
 *
 * 触控映射（M9，FR-14.1）：Cornerstone3D 5.8.2 的 touch 事件监听在
 * init() 后随 enableElement 自动挂到视口元素（addEnabledElement →
 * touchEventListeners + touchToolEventDispatcher），工具按 binding 命中：
 * - 单指触摸（numTouchPoints=1）→ 命中 defaultMousePrimary（Primary）
 *   绑定的工具 = 当前主工具（与桌面左键同一套工具状态，天然共用）；
 * - 双指触摸（numTouchPoints=2）→ ZoomTool 的 { numTouchPoints: 2 } 常驻
 *   绑定；ZoomTool 内置 pinchToZoom（捏合缩放）+ pan（双指拖动平移）；
 * - 双击（TOUCH_TAP taps=2）→ 适应窗口，由 DicomViewport 订阅
 *   TOUCH_TAP_EVENT（见 touchEvents.ts，与桌面 dblclick 同语义，FR-3.4）。
 *
 * TODO(FR-14.1)：双指拖动窗宽窗位、双指旋转（P1，与双指平移缩放手势
 * 冲突，需独立手势仲裁后实现）；长按进入拖拽手柄模式（防误触，P1）。
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
  | typeof ToolNames.stackScroll
  | typeof ToolNames.length
  | typeof ToolNames.angle
  | typeof ToolNames.rectangleRoi
  | typeof ToolNames.ellipticalRoi
  | typeof ToolNames.probe;

/** 测量工具（M10-D 转正：FR-5.1~5.6 主工具入口） */
export const MEASUREMENT_TOOLS: readonly string[] = [
  ToolNames.length,
  ToolNames.angle,
  ToolNames.rectangleRoi,
  ToolNames.ellipticalRoi,
  ToolNames.probe,
];

/** 左键可切换为「主」工具的全部工具（常驻交互 + 测量） */
const PRIMARY_SELECTABLE_TOOLS: readonly string[] = [
  ToolNames.windowLevel,
  ToolNames.zoom,
  ToolNames.pan,
  ToolNames.stackScroll,
  ...MEASUREMENT_TOOLS,
];

/**
 * 全部需挂载到 ToolGroup 的工具名（常驻 + 测量）。
 * 注意：initializeTools() 的 addTool 只注册到全局工具表，
 * ToolGroup.addTool 才会把实例放入 _toolInstances 并填充
 * toolOptions——缺了它 setToolActive 会静默失效，事件派发
 * 找不到任何激活工具。
 */
export const ALL_TOOL_NAMES: readonly string[] = [
  ToolNames.windowLevel,
  ToolNames.zoom,
  ToolNames.pan,
  ToolNames.stackScroll,
  ...MEASUREMENT_TOOLS,
];

/** 各工具的常驻绑定（不随主工具切换而丢失） */
const PERSISTENT_BINDINGS: Readonly<Record<string, readonly ToolBinding[]>> = {
  [ToolNames.pan]: [{ mouseButton: MouseBindings.Auxiliary }],
  [ToolNames.zoom]: [
    { mouseButton: MouseBindings.Wheel, modifierKey: KeyboardBindings.Ctrl },
    // 双指触摸（FR-14.1/AC-28）：numTouchPoints 绑定不占用鼠标键，
    // 随 passive/active 切换恒保留（setToolPassive 仅剥离 Primary）；
    // ZoomTool 内置 pinchToZoom 捏合缩放 + pan 双指平移。
    { numTouchPoints: 2 },
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
 *
 * ToolGroup id 必须按视口唯一：ToolGroupManager 以 id 全局唯一存储，
 * 多视口共享同一 RenderingEngine 时若以引擎 id 命名，第二个视口
 * createToolGroup 会因重名返回 undefined（仅 console.warn）→
 * 视口初始化失败、pipelineReady 永不就绪 → 该视口空白。
 */
export function createBoundToolGroup(
  renderingEngineId: string,
  viewportId: string,
): ToolGroup {
  const toolGroup = ToolGroupManager.createToolGroup(
    `${renderingEngineId}:${viewportId}`,
  );
  if (!toolGroup) {
    throw new Error(`创建 ToolGroup 失败: ${renderingEngineId}/${viewportId}`);
  }
  // 先挂载全部工具实例，再激活绑定（setToolActive 对未挂载工具静默 return）
  for (const toolName of ALL_TOOL_NAMES) {
    toolGroup.addTool(toolName);
  }
  toolGroup.addViewport(viewportId, renderingEngineId);
  syncToolBindings(toolGroup, ToolNames.windowLevel);
  return toolGroup;
}

/**
 * 将 Primary 鼠标按钮分配给指定主工具，其余主工具退出 Primary 绑定。
 *
 * Cornerstone3D 的 setToolActive 会把新 bindings 与旧 bindings **合并**
 * （ToolGroup.js: [...prevBindings, ...newBindings] 去重），传 bindings:[]
 * 并不能清掉历史 Primary —— 这正是「切换只换高亮不换行为」缺陷的根因：
 * WindowLevel 永远残留 Primary，事件派发（getActiveToolForMouseEvent）
 * 按 addTool 顺序遍历 toolOptions，先命中 WindowLevel → 永远窗宽窗位。
 *
 * 因此这里统一采用「先 setToolPassive 剥离 Primary，再按目标状态重建」：
 * - setToolPassive 默认移除 Primary 绑定并保留其余绑定；
 *   若仍有剩余绑定则保持 Active（中键平移/Ctrl+滚轮缩放/滚轮翻页因此不丢）；
 * - 随后按需重建：主工具拿 Primary + 各自常驻绑定；非主工具仅常驻绑定。
 *   （对从未激活过的工具，passive 后无任何绑定，必须显式重建常驻绑定。）
 *
 * @param primary 目标主工具名；传 null 视为恢复默认（窗宽窗位）
 */
export function syncToolBindings(
  toolGroup: ToolGroup,
  primary: string | null,
): void {
  const activeTool = primary ?? ToolNames.windowLevel;
  for (const toolName of PRIMARY_SELECTABLE_TOOLS) {
    // 剥离历史 Primary 绑定（避免 merge 残留），保留常驻绑定
    toolGroup.setToolPassive(toolName);
    const bindings =
      toolName === activeTool
        ? [{ mouseButton: MouseBindings.Primary }, ...(PERSISTENT_BINDINGS[toolName] ?? [])]
        : [...(PERSISTENT_BINDINGS[toolName] ?? [])];
    if (bindings.length > 0) {
      // 与 passive 保留下的常驻绑定合并去重后即为目标绑定集合
      toolGroup.setToolActive(toolName, { bindings });
    }
    // windowLevel / 测量工具 无常驻绑定且非主工具时停在 Passive：不再响应任何鼠标输入
  }
}

/** 销毁 ToolGroup（视口卸载时调用，防泄漏）。 */
export function destroyBoundToolGroup(toolGroup: ToolGroup): void {
  ToolGroupManager.destroyToolGroup(toolGroup.id);
}
