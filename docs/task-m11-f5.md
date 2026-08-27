# 任务书 M11-F5：3D 面板 WW/WL 实时跟随中键拖动 + 渲染预设恢复默认窗宽窗位

## 项目
/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版+vtk.js 36.4.1）

## 用户反馈（真机验证 M11-F3/F2 后，3D 体绘制界面）
1. **中键拖动调窗宽窗位时，面板 WW/WL 数值应该实时跟着变化**——现在体绘制画面在变（工具生效），但面板输入框数字不动。
2. **点击渲染预设（CT-Bone/CT-Angio/CT-Soft-Tissue/CT-Skin/MIP）后，WW/WL 必须恢复为该预设的默认值**——现在切换预设后保持的是用户当前的窗宽窗位（旧行为），语义不对。

## 监督方已掌握的证据（headless 探测，你需确认根因后修）
- 绑定本身正确：WindowLevelTool 已 addTool + Auxiliary 绑定（toolGroup.ts M11-F3），真机中键拖动画面变化。
- **组件的 VOI_MODIFIED 监听没收到事件**：监督方在 3D 元素上挂 `VOI_MODIFIED` 监听（capture 与冒泡均试），中键拖动期间 0 个事件；面板输入框值恒为 400/40。
- 预设切换代码 `Volume3dViewport.tsx` 的预设 effect：`applyPresetToViewport(vp, preset).then(() => applyWwWlToViewport(vp, lastWw, lastWl))`——刻意保留当前 WW/WL（M10 行为，需按新需求改）。
- 面板输入是 React 受控组件（ww/wl state + wwDraft/wlDraft），正常路径：监听 VOI_MODIFIED（detail.viewportId === VOLUME3D_VIEWPORT_ID）→ setWw/setWl + setWwDraft/setWlDraft。

## 修复要求
1. **先查根因再修**：为什么 VOI_MODIFIED 没到面板？候选：
   a) Cornerstone 5.8.2 的 VOLUME_3D 视口 `setProperties({voiRange})` 不派发 VOI_MODIFIED（读 node_modules/@cornerstonejs/core 对应 viewport 类源码求证）；
   b) 事件派发在别的 eventTarget/元素上；
   c) 事件 detail 结构与面板监听读取字段不匹配。
   给出证据链（源码行号）。
2. **修复实时跟随**：按根因选最小可靠方案（候选：改用 cornerstone 事件目标 util 监听 / 子类化 WindowLevelTool 在 mouseDragCallback 末尾补发自定义事件 / 拖动期间 rAF 轮询 viewport.getProperties().voiRange 更新面板）。要求拖动过程实时（不要只在 mouseup 后跳一次）。修复后 3D 面板 WW/WL 数字与画面 VOI 一致，且「联动 2D」（FR-7.3，2D 侧的 linkedWwWl 覆盖）行为不破坏——若联动链路依赖同一 VOI_MODIFIED 事件，一并验证/修复。
3. **预设恢复默认**：预设 effect 改为「应用预设后把 WW/WL 重置为该预设默认值（presets.ts 里的 ww/wl），同步更新面板 state 与输入框」。预设切换后 lastWwWlRef 也更新为新预设默认值。其他保持 WW/WL 的路径（初始挂载联动 2D）不变。
4. i18n 如有涉及文案（无则不动）；不改 2D/MPR 的任何行为。

## 测试要求
- 新增单测：①预设切换后 WW/WL 重置为预设默认（mock viewport 断言 setProperties 调用参数 + 面板 state）；②中键拖动路径触发面板更新（按你的修复方案写调用链测试：如自定义事件派发→面板 state 更新，或轮询更新）。
- 更新被预设行为变化影响的既有断言（如有断言「保持当前 WW/WL」的），列出改动。
- 回归：m10.vol3dViewport / m11.vol3dEntrance / m11.bindings 相关用例全绿。

## 约束
- 内存紧张：只跑 `npx tsc --noEmit` + 涉及测试文件，禁止全量 vitest/build（监督方复跑）。
- 独立 commit（`<type>(<scope>): 描述`）+ `git push origin master`（失败报告即可）。
- 不写 Home 外目录；范围克制。
- stdout 简报：根因证据链 + 修复方案 + 测试清单；不要自行 Playwright（监督方复测）。