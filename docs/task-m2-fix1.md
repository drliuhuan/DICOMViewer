# 任务书：M2 验收缺陷修复 — 关闭序列后视口图像未清除

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`
- 用户真机反馈（FR-2.9 缺陷）：**关闭序列后，视口中仍残留该序列的图像**（图像未卸载干净）

## 根因（主 agent 已定位，源码级确认）
`src/features/viewer/DicomViewport.tsx` 堆栈 effect（约 284 行）：

```ts
useEffect(() => {
  if (imageIds.length === 0) {
    setRenderError(null);
    setProbe(null);
    publishUi({ sliceIndex: 0, sliceCount: 0 });
    return undefined;    // ← BUG：只重置了 React UI 状态，没清 cornerstone 视口
  }
  ...
```

关闭序列时 App 层把 `assignments[viewportId]` 置 null → items → imageIds 变 `[]` → 此分支只清了 UI 状态，**viewport 的 canvas 上仍显示旧图像**。`releaseSeries` 虽释放了 imageId 缓存/注册表，但已渲染的纹理仍在画布上。

## 修复要求
在 `imageIds.length === 0` 分支中**清空 cornerstone 视口**：
1. 调用 `viewport.clear()`（StackViewport 的标准清空 API，会清掉当前图像与堆栈），随后 `viewport.render()`（或 clear 内部触发渲染——读 `@cornerstonejs/core` 源码确认 clear 行为，若 clear 后不自动渲染则补 render）
2. 需在 `viewportRef.current` 可用时执行；`pipelineReady` 未就绪或 viewport 不存在时保持静默跳过（与现有容错一致）
3. 清空后视口应显示空白（纯黑背景），无残留图像
4. 同时检查 `releaseAll`（清空全部）路径：App 的 clearAll 是否同样触发 viewport 清空——`assignments` 全置 null 后每个视口的 effect 都会走 `imageIds.length === 0` 分支，故修好此分支两处场景都覆盖

## 验证要求（本机无浏览器，单测锁行为）
1. 新增/扩展 `tests/m1.viewportResize.test.tsx` 或新建测试：渲染 DicomViewport，先 setStack 模拟加载 → 切到 imageIds=[] → 断言 `viewport.clear()` 被调用（mock StackViewport 记录调用）+ UI 状态归零
2. 既有 164 测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error；eslint 干净
3. 单独 commit：`fix(viewer): 关闭序列后清空视口图像（viewport.clear）`

## 输出
stdout 简报：clear API 行为确认、改动 diff、单测结果。
