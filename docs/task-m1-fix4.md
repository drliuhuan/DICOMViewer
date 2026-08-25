# 任务书：M1 验收缺陷修复 — 工具切换只换图标不换功能

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`
- 用户真机反馈 + 主 agent Playwright 复现确认：**点击工具栏「缩放/平移/层滚动」后按钮高亮切换，但左键拖动的行为仍是窗宽窗位（WW/WL 继续变化，缩放/平移不生效）**

## 复现证据（Playwright，5帧DICOM）
1. 默认窗宽窗位：左键拖动 → WW/WL 400/40→412/48 ✅
2. 点「缩放」→ 左键拖动 → **WW/WL 仍在变（412→396），缩放恒 100%** ❌
3. 点「平移」→ 左键拖动 → **WW/WL 仍在变（396→406），图像不平移** ❌
截图：视口工具栏「平移」高亮，但行为未切换。

## 根因分析（主 agent 初判，需你验证后修）
`src/features/viewer/toolSetup.ts` 的 `syncToolBindings()`：

```ts
for (const toolName of PRIMARY_DRAG_TOOLS) {
  const bindings = [
    ...(toolName === activeTool ? [{ mouseButton: MouseBindings.Primary }] : []),
    ...(PERSISTENT_BINDINGS[toolName] ?? []),
  ];
  toolGroup.setToolActive(toolName, { bindings });
}
```

疑点（请读 `node_modules/@cornerstonejs/tools/dist/esm/store/ToolGroupManager/ToolGroup.js` 的 `setToolActive` 实现确认）：
- `setToolActive` 更新 `toolOptions[toolName].bindings` 后，**是否对"之前已 Active、现在 bindings 变化"的工具正确生效**？特别注意：被取消 Primary 的工具（如 WindowLevel 切走后 bindings 只剩空数组 `[]`）——`bindings: []` 传给 setToolActive 是否等价于"无绑定仍 Active"，还是需要显式 `setToolPassive`/`setToolDisabled`？
- Cornerstone3D 惯用法是**切换主工具时把非主工具设为 Passive**（`toolGroup.setToolPassive(name)`），只给主工具 setToolActive。当前实现把 4 个工具全部保持 Active + 动态 bindings，可能与库的匹配逻辑不兼容（`getActiveToolForMouseEvent` 按 bindings 数组匹配，多个工具含相同 binding 时取遍历到的第一个——`toolOptions` 的 key 顺序是 addTool 顺序，WindowLevel 最先注册 → 永远匹配到它）。

**最可能根因**：`Object.keys(toolGroup.toolOptions)` 顺序 = addTool 顺序 = [windowLevel, zoom, pan, stackScroll,...]。切到"平移"后，windowLevel 的 bindings 若仍含 Primary（比如 `setToolActive(name, {bindings: []})` 未清掉旧绑定，或空数组被视为"保持原样"），匹配循环先命中 windowLevel → 永远窗宽窗位。

## 修复要求
改为 Cornerstone3D 标准切换模式：
```ts
export function syncToolBindings(toolGroup, primary) {
  const activeTool = primary ?? ToolNames.windowLevel;
  for (const toolName of PRIMARY_DRAG_TOOLS) {
    if (toolName === activeTool) {
      toolGroup.setToolActive(toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
    } else {
      toolGroup.setToolPassive(toolName);   // 关键：非主工具显式 Passive
    }
  }
  // 常驻绑定工具(中键平移/Ctrl+滚轮缩放/滚轮翻页)不受主工具切换影响,保持 Active:
  // Pan: Auxiliary 中键; Zoom: Ctrl+Wheel; StackScroll: Wheel —— 这三个的常驻绑定
  // 需要保留。若 setToolPassive 会清掉常驻绑定,则改为:
  //   setToolActive(pan, {bindings:[Auxiliary]})
  //   setToolActive(zoom, {bindings:[{Wheel, Ctrl}]})
  //   setToolActive(stackScroll, {bindings:[Wheel]})
  // 即"主工具拿 Primary,其余三个只保留各自的常驻绑定",绝不给非主工具 Primary。
}
```
注意读 ToolGroup.js 源码确认 `setToolPassive` 的确切行为（是否清 bindings），选择能达成下述验收的实现。**常驻绑定不能丢**：中键平移、Ctrl+滚轮缩放、滚轮翻页在主工具切换后必须继续工作。

## 验证要求（本机无浏览器，用单测锁行为）
1. 新增/扩展 `tests/m1.toolgroup.test.ts` 用例：
   - 切到 `pan` 后：pan 的 bindings 含 Primary；windowLevel 的 bindings **不含** Primary（且不含任何鼠标键或为 Passive 态）
   - 切到 `zoom` 后同理；切回 null/windowLevel 恢复默认
   - 常驻绑定断言：任意主工具下，pan 恒有 Auxiliary、zoom 恒有 Ctrl+Wheel、stackScroll 恒有 Wheel
2. 既有 54 测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error
3. 单独 commit：`fix(tools): 主工具切换真正生效（非主工具退出 Primary 绑定）`

## 输出
stdout 简报：ToolGroup.setToolActive/Passive 源码行为结论、修复 diff、单测结果。
