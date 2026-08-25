# 任务书：M1 验收缺陷修复 — 渲染引擎就绪竞态

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`，M1 已完成但真机验收发现阻断级 bug
- 复现：headless Chromium 注入多帧 DICOM 后视口永久显示「图像显示失败：渲染引擎尚未就绪」，20 秒不恢复
- 验收脚本日志：`[error] [DicomViewport] 显示失败 Error: 渲染引擎尚未就绪`

## 根因（主 agent 已定位，直接修）
`src/features/viewer/DicomViewport.tsx` 存在初始化竞态：

1. 挂载期 `useEffect` 里 `void initializeTools().then(() => { ...enableElement...; viewportRef.current = viewport })` —— **异步**
2. 堆栈加载的 `useEffect`（约 267 行起）读 `viewportRef.current`，为 null 时 `throw new Error('渲染引擎尚未就绪')` 并 setRenderError —— **错误后无重试**
3. 文件加载快于 tools init 完成时（首次打开必然如此），堆栈 effect 先跑 → 永久失败

M0 单文件路径时序不同未暴露；M1 多文件注入路径必现。

## 修复要求（选一，倾向 A）
**A（推荐）**：把「管线就绪」变成显式状态。挂载 effect 改为 `await` 一个组合 Promise（`initializeTools()` + `initializeDicomPipeline()`），就绪后再 `enableElement` 并 set `ready` state；堆栈 effect 在 `!ready` 时跳过（不报错），`ready` 变 true 后重新触发加载（加入依赖数组）。保证：
- `viewportRef.current` 被读时必非 null
- 错误路径仍保留（真异常时依旧提示）
- 卸载清理逻辑不变（disposed 检查覆盖 await 之后的全部路径）

**B（备选）**：堆栈 effect 内等待 `initializeTools()` 完成后再读 viewportRef，并加轮询/重试上限。

## 硬性约束
- 不要改 `vite.config.ts`（events polyfill 别动）
- 不要动 `src/dicom/imageId.ts` 的注册表语义
- TypeScript 严格模式保持 0 error
- 修复后 `npx vitest run` 全绿（48 个既有测试不许挂）

## 验收标准
- [ ] 修复提交单独一个 commit：`fix(viewport): 消除 tools 初始化与堆栈加载的竞态`
- [ ] `npm run build` 通过、vitest 48+ 全绿、tsc 0 error
- [ ] 代码里不再存在「读 viewportRef 前未确保 enableElement 完成」的路径
- [ ] stdout 输出：改动文件清单 + 关键 diff 摘要

## 输出
简报：根因一句话、修复方案、改动文件、验证结果。
