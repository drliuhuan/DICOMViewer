# 任务书 M11-F4：屏蔽视口右键菜单

## 项目
/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版）

## 用户反馈（真机验证 M11-F3 后）
鼠标绑定矩阵功能全部正常（左键平移/中键窗宽窗位/右键滚动与旋转均工作），但**右键按下拖动时浏览器原生上下文菜单仍会弹出**，干扰操作。需屏蔽。

## 修复要求
1. 在**视口容器层**阻止 `contextmenu` 默认行为：2D 视口（DicomViewport/ViewerCell 的 cornerstone-element 容器）、MPR 视口（MprViewport）、3D 视口（Volume3dViewport）。推荐 React 层 `onContextMenu={(e) => e.preventDefault()}` 挂在含 cornerstone-element 的容器（或统一挂视口网格 wrap 一层），不要全局 document 级屏蔽（面板内右键粘贴等浏览器能力不受影响）。
2. 确认不影响右键拖动的 cornerstone 交互（preventDefault 只挡菜单，不拦截 mousedown/mousemove 事件流）。
3. 若项目有 info overlay/探针在视口内的自定义右键菜单（grep 确认），保持其工作（先 preventDefault 再走自定义逻辑，若存在）。

## 测试要求
- 新增/更新渲染测试：断言视口容器 contextmenu 事件被 preventDefault（dispatchEvent new MouseEvent('contextmenu', {cancelable:true}) 后 defaultPrevented===true），2D/MPR/3D 三处。
- 既有测试如断言冲突如实更新并列出。

## 约束
- 内存紧张：只跑 `npx tsc --noEmit` + 涉及测试文件，禁止全量 vitest/build（监督方复跑）。
- 独立 commit（`<type>(<scope>): 描述`）+ `git push origin master`（失败报告即可）。
- 不写 Home 外目录；范围克制（这是单点小修，不要顺手改其他绑定）。
- stdout 简报：改动文件 + 测试结果；不要自行 Playwright（监督方复测）。