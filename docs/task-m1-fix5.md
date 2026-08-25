# 任务书：M1 验收缺陷修复 — 布局切换后图像比例失调

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`
- 用户真机反馈：**切换 1×1 → 1×2（或 2×2）布局时，视口容器尺寸变化但图像未按新尺寸重排，出现拉伸变形（比例失调）**

## 根因分析（主 agent 初判，请验证后修）
Cornerstone3D 渲染引擎在 `enableElement` 时按元素当时的尺寸设置 canvas；**容器尺寸变化后必须调用 `renderingEngine.resize()`** 才会重算 canvas 尺寸与相机（保持纵横比）。

当前 `src/features/viewer/DicomViewport.tsx`：
- 挂载时 `enableElement` 一次，之后布局切换只是 CSS 网格变化（`.viewer-grid` 的 grid-template 改变），**没有任何 resize 响应**
- 缺失两件事：
  1. **ResizeObserver** 监听视口容器尺寸变化 → 调 `renderingEngine.resize()`（Cornerstone3D 标准 API，带 `keepCamera=true` 保持当前缩放/平移状态）
  2. 布局切换时（App 层 layout state 变化）触发一次 resize

## 修复要求
1. 在 `DicomViewport.tsx` 挂载 effect 中创建 `ResizeObserver`，观察 `containerRef.current`（或其父容器）：
   - 回调中调用 `getSharedRenderingEngine().resize(true, true)`（读 RenderingEngine.js 源码确认签名：`resize(immediate, keepCamera)` 或等效），**必须 keepCamera** 避免用户缩放/平移状态丢失
   - 注意防抖（如 rAF 或 100ms debounce），布局动画期间避免连续 resize
   - 卸载时 disconnect
2. 确认 resize 后 `viewport.render()` 被触发（看 resize 是否内部触发渲染，不触发则补一次）
3. 布局从 1×1 → 1×2 → 2×2 → 1×1 往返后，图像应始终**保持原始纵横比**（16×16 的图不能被拉成长方形），且用户的 WW/WL 不变

## 验证要求（本机无浏览器，单测锁行为）
1. 扩展测试：断言 DicomViewport 挂载时创建了 ResizeObserver 并 observe 容器；卸载时 disconnect（mock ResizeObserver）
2. 断言 resize 回调调用了 renderingEngine.resize 且参数含 keepCamera=true
3. 既有测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error
4. 单独 commit：`fix(viewer): 布局切换后按容器尺寸重排图像（ResizeObserver + keepCamera resize）`

## 输出
stdout 简报：resize API 签名确认、改动文件、单测结果。
