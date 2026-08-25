# 夜间自动任务书（护士进程生成）

## 全局约束（必须遵守）
- 项目：/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版本四包+dicom-parser 1.8.21+dcmjs）
- 本机无显示器无浏览器：一切验证靠单测（vitest/jsdom）。禁止启动 dev server 等待人工确认。
- 完成定义(DoD)：`npm run build`(含tsc) 通过；`npx vitest run` 全绿（不许删/跳过既有测试）；`npx eslint src tests` 不新增 error。
- 新功能必须带单测（mock @cornerstonejs/* 模块，参考既有 tests/m*.test.tsx 的 mock 手法）。
- 完成后自行 git commit（一行中文 message，格式 `<type>(<scope>): 描述（FR编号）`），但【不要】git push（监督进程统一推）。
- Cornerstone 已知坑：ToolGroup 必须 addTool 后才能 setToolActive；init 异步完成后才能 enableElement；events alias 别动。
- 范围克制：只做本任务书列的条目，不做"顺手重构"；UI 文案用简体中文。
- 若某子项确实无法完成（依赖缺失等），在代码中留 TODO 注释并在 commit message 里说明，不要阻塞其他子项。

# 任务书 M3：测量与标注（FR-5 核心项）

## 背景
当前 git 状态：
a70a1fb night(task-m2-fix1): via opencode qwen3.8-27b, gate=OK, 71min
7677def fix(viewer): 关闭序列后清空视口图像（viewport.clear）
0b3e070 docs: M2 验收缺陷任务书(关闭序列视口残留)
f8892f9 docs: M2 报告
91936e3 feat(app): 数据集关闭与资源释放 + 清空全部二次确认（FR-2.9）
04adb8f feat(series): 序列首帧缩略图与缓存上限（FR-2.4）
81b9cad feat(series): 实例排序补全 SliceLocation→IPP 法向量投影链（FR-2.3）
cb186af feat(ui): 序列面板升级为患者→检查→序列树 + 视口序列角标（FR-2.1/2.2/2.7/2.8）
55b2c7c feat(series): SOPInstanceUID 文件去重与跨批次累积加载（FR-1.11）
f7fd65f feat(dicom): 增强型多帧逐帧位置与四级元数据层级（FR-1.8/1.10）


toolSetup.ts 现状（测量工具已注册为占位 PLACEHOLDER_MEASUREMENT_TOOLS，激活仅提示"M3 提供"）：
```ts
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

/**
 * 全部需挂载到 ToolGroup 的工具名（常驻 + 占位测量）。
 * 注意：initializeTools() 的 addTool 只注册到全局工具表，
 * ToolGroup.addTool 才会把实例放入 _toolInstances 并填充
 * toolOptions——缺了它 setToolActive 会静默失效，事件派发
 * 找不到任何激活工具。
 */
export const ALL_TOOL_NAMES: readonly string[] = [
  ...PRIMARY_DRAG_TOOLS,
  ...PLACEHOLDER_MEASUREMENT_TOOLS,
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
  for (const toolName of PRIMARY_DRAG_TOOLS) {
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
    // windowLevel 无常驻绑定且非主工具时停在 Passive：不再响应任何鼠标输入
  }
}

/** 销毁 ToolGroup（视口卸载时调用，防泄漏）。 */
export function destroyBoundToolGroup(toolGroup: ToolGroup): void {
  ToolGroupManager.destroyToolGroup(toolGroup.id);
}

```

## 交付目标（本次全做）
1. **FR-5.1 长度测量(P0)**：左键 Length 工具两点连线，实时显示物理长度(mm)，基于 PixelSpacing/影像平面像素间距；端点可拖动微调；显示保留2位小数(FR-5.13 双精度计算)。
2. **FR-5.2 角度测量(P0)**：三点两线夹角(°)+两线段各自长度。
3. **FR-5.3 矩形ROI(P0)** 与 **FR-5.4 椭圆ROI(P0)**：框选区域统计——均值、标准差、最小、最大、面积(mm²)、像素数。
4. **FR-5.7 统计实时更新(P0)**：拖动 ROI 或改 WW/WL 时统计重算；**统计必须基于 Modality LUT 后原始像素值(HU)，不得使用显示 LUT 后的值**（技术决策 §7.5 有明确警告）。
5. **FR-5.6 点标注(P1)**：Probe 点标注显示该点灰度值（文本/箭头可缓，TODO 即可）。
6. **FR-5.8 校准兜底(P0)**：PixelSpacing 缺失或为0时，长度/面积显示"无法计算物理尺寸"提示；提供简单手动校准入口（画一条线输入真实mm，写入该序列校准系数）——实现可以最简化，但路径要通。
7. **工具栏接入**：主工具切换 UI 增加 长度/角度/矩形/椭圆/点 五个选项（复用现有 PrimaryDragTool 切换体系；测量工具作为一次性绘制工具激活，画完自动回到窗宽窗位是允许的简化）。移除原"M3 提供"占位拦截。
8. **FR-5.10 帧关联(简化版)**：标注随序列关闭而清理（cornerstone annotation 自带 frameOfReference 关联即可，翻页过滤如果 cornerstone 默认行为不满足再做）。

## 明确不做（留给后续）
FR-5.5 徒手ROI、FR-5.9 管理面板、FR-5.11 导入导出、FR-5.12 SR导出、FR-5.14 吸附、FR-5.15 MPR上测量、FR-5.16 撤销重做、FR-5.17 直方图。

## 单测要求（重点！）
- 用合成像素数据验证 ROI 统计数值正确性：构造已知值的 jsdom mock 图像数据（如全部=100±固定噪声），断言 mean/std/min/max 在容差内。
- 长度计算：已知 PixelSpacing=(0.7,0.7)，两点(0,0)-(10,0) 断言 7.00mm。
- 角度：三点构造90°断言 90±0.1°。
- 工具注册/激活链路：mock tools 模块断言 LengthTool 被 addTool 且能 setActive。
- 统计用原始值而非 LUT 值：这是最容易错的一点，必须有专门测试。

## 输出
commit（不push）+ stdout 简报：每个 FR 一行完成状态 + 单测数量统计。
