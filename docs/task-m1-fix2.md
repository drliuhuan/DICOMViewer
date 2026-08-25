# 任务书：M1 验收缺陷修复 — ToolGroup 未注册工具导致全部工具失效

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`
- M1 已完成但真机验收发现**阻断级 bug**：滚轮翻页、左键窗宽窗位拖动、中键平移**全部无响应**（UI 按钮/键盘翻页正常，因为它们走 React 层不走工具）

## 根因（主 agent 已定位到库源码，直接修）
`src/features/viewer/toolSetup.ts` 的 `createBoundToolGroup()`：

```ts
export function createBoundToolGroup(renderingEngineId: string, viewportId: string): ToolGroup {
  const toolGroup = ToolGroupManager.createToolGroup(renderingEngineId);
  toolGroup.addViewport(viewportId, renderingEngineId);
  syncToolBindings(toolGroup, ToolNames.windowLevel);
  return toolGroup;
}
```

**缺失 `toolGroup.addTool(...)` 调用。** 证据链（库源码 `@cornerstonejs/tools@5.8.2`）：

1. `ToolGroup.setToolActive`（ToolGroup.js:160-163）开头：
   `const toolInstance = this._toolInstances[toolName]; if (toolInstance === undefined) { console.warn('Tool ${toolName} not added to toolGroup...'); return; }`
   —— 工具没 addTool 进 toolGroup 时**静默 return**（warn 被吞），不设置 mode/bindings。
2. `initializeTools()` 里的 `addTool(...)` 是 cornerstoneTools.addTool——只注册到全局 `state.tools`，**不等于** `toolGroup.addTool()`（ToolGroup.addTool 才把实例放进 `this._toolInstances` 并填充 toolOptions）。
3. 事件派发链（wheelListener → triggerEvent → mouseWheel dispatcher → `getActiveToolForMouseEvent`）正常——`getActiveToolForMouseEvent` 遍历 `Object.keys(toolGroup.toolOptions)`，**toolOptions 为空 → 返回 undefined → 工具永不响应**。

## 修复要求
在 `createBoundToolGroup` 中、`addViewport` 之前，把所有已注册工具逐个 `toolGroup.addTool(toolName)`：

```ts
const ALL_TOOLS = [
  ToolNames.windowLevel, ToolNames.zoom, ToolNames.pan, ToolNames.stackScroll,
  ...PLACEHOLDER_MEASUREMENT_TOOLS,  // Length/Angle/RectangleROI/EllipticalROI/Probe
];
for (const name of ALL_TOOLS) {
  toolGroup.addTool(name);
}
```

（请按项目现有代码风格与命名组织，如导出 `ALL_TOOL_NAMES` 常量；PLACEHOLDER_MEASUREMENT_TOOLS 已在文件内定义。）

## 验证要求（重要：本机无浏览器，必须用 Node 单测覆盖）
1. **新增单元测试** `tests/m1.toolgroup.test.ts`：mock `@cornerstonejs/tools` 的 `ToolGroupManager`/`ToolGroup`，断言：
   - `createBoundToolGroup` 对每个工具调用过 `toolGroup.addTool(name)`（含 4 个常驻工具 + 5 个测量占位工具）
   - `addTool` 调用发生在 `setToolActive` 之前（调用顺序）
2. 既有 48 个测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error
3. 单独 commit：`fix(tools): ToolGroup 注册全部工具，修复工具事件静默失效`

## 输出
stdout 简报：改动 diff 摘要、单测结果。
