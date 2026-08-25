# 任务书：M1 验收缺陷修复 — 三项（提示横幅移除 / 拖拽序列加载 / 多视口任意序列）

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`，M1 真机验收中用户提出三项问题，合并一个任务修复。
- 另有一个**部署层遗留问题**（非本任务代码范围，主 agent 处理）：多帧拆帧修复（commit 79d8ba2）在单测中通过但真机仍报 `no pixel data`，怀疑 dist 未含新代码——主 agent 会先核实构建产物，你无需处理部署，只管代码正确性。

## 缺陷 1：移除操作提示横幅
- 现状：视口下方/内部有一条常驻提示「多选/拖拽打开 · 滚轮翻页 · Ctrl+滚轮缩放 · 中键平移 · 点击序列载入激活视口」。
- 要求：**整体移除**（用户明确要求去掉）。搜索该文案所在组件（可能在 App.tsx 或 ui 组件），删除该 DOM 及其样式；确认无残留空白占位。

## 缺陷 2：支持从左侧序列面板拖拽序列到视口
- 现状：序列面板只支持点击加载到激活视口。
- 要求：序列卡片可**拖拽**（HTML5 drag & drop，draggable=true + dragstart 携带 seriesUid），视口作为放置目标（dragover preventDefault + drop 读取 seriesUid → 加载到该视口）。放置时给视口加高亮反馈（拖拽悬停态样式）。
- 点击行为保留不变（点击=加载到激活视口）。
- 注意与全局窗口拖拽打开文件（dragDepthRef 那套）互不干扰：序列卡片 dragstart 设置的数据要在 drop 时能区分「内部序列拖拽」与「外部文件拖拽」（如 dataTransfer.setData('application/x-series-uid', uid)），外部文件 drop 逻辑不受影响。

## 缺陷 3：多视口应能显示任意序列
- 现状：激活多个视口时（1×2/2×2），**只有第一个视口能正常显示第一个序列的影像**，其他视口加载其他序列失败或空白。
- 要求：**每个视口都可以加载显示任意序列**（任意视口 × 任意序列组合都要正常渲染）。
- 排查方向（主 agent 初判，请验证）：
  1. `DicomViewport.tsx` 的 `RENDERING_ENGINE_ID` 是全局单例 + `viewportId` 区分视口——检查多视口时 `enableElement` 的 viewportId 是否唯一（vp-0/vp-1/vp-2/vp-3）；
  2. 检查 `createBoundToolGroup` 是否为**每个视口独立创建 ToolGroup**（ToolGroupManager 对同 viewport 重复 create 会返回 null/抛错？看 `createToolGroup` 源码——已存在同 id 会 warn 并 return undefined，注意 toolGroup id 的唯一性）；
  3. 检查 `assignments` 状态 → 各视口 imageIds 的映射逻辑（App.tsx），确认非 vp-0 视口加载序列时 imageIds 正确传递；
  4. 复现路径：打开含 1 个多帧序列 → 切 1×2 → 点击第二个视口激活 → 点击序列加载 → 观察第二个视口是否渲染。若单序列多视口是允许的场景（同一序列显示在两个视口），也要保证正常（同一 imageId 在两个 viewport 各自 setStack）。
- 修复后：2×2 下四个视口分别加载不同序列（或同序列）都应正常显示、独立翻页、独立 WW/WL。

## 验证要求（本机无浏览器，单测锁行为）
1. 缺陷1：断言提示文案组件已移除（App 渲染输出不含该字符串）。
2. 缺陷2：单测模拟序列卡片 dragstart → dataTransfer 携带 seriesUid；视口 drop handler 读取并调用加载逻辑（mock 断言）。
3. 缺陷3：单测断言多视口各自独立 enableElement（viewportId 唯一）、各自 ToolGroup、assignments 映射正确。
4. 既有测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error。
5. **三个缺陷各自独立 commit**：
   - `fix(ui): 移除操作提示横幅`
   - `feat(viewer): 序列面板拖拽序列到指定视口`
   - `fix(viewer): 多视口可加载显示任意序列`

## 输出
stdout 简报：每项的根因/实现方式、改动文件、测试结果。
