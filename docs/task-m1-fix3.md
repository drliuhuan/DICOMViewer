# 任务书：M1 验收缺陷修复 — 多帧 DICOM 翻页不换帧

## 背景
- 项目：`/home/drliuhuan/DICOMViewer`
- 真机验收（headless Chromium + 5 帧合成 DICOM）发现：**滚轮翻页后层号 UI 更新（1→5），但 canvas 图像始终显示第 1 帧**，帧内容不切换

## 根因（主 agent 已定位）
页面控制台报错（每翻一帧报一次）：
```
loadImageFromNaturalizedMetadata: no pixel data in NATURALIZED for imageId dcm-file://<uuid>?frame=2
loadImageFromNaturalizedMetadata: no pixel data in NATURALIZED for imageId dcm-file://<uuid>?frame=3
...
```

- 加载管线：`src/dicom/imageId.ts` 的 `loadDcmFileImage()` 用 `utilities.addDicomPart10Instance(imageId, buffer)` 挂 NATURALIZED 元数据，再委托 `loadImageFromNaturalizedMetadata`。
- **问题**：多帧文件展开时 imageId 形如 `dcm-file://<uuid>?frame=N`（`buildStacks.ts` 按 NumberOfFrames 展开）。`addDicomPart10Instance` 挂载时用的是**带 ?frame=N 的完整 imageId** 作为 key——但 NATURALIZED 元数据存储里，像素数据（PixelData）只解析了一次（对应整份 Part10 buffer），frame=N 的派生 imageId 查不到独立像素条目 → `no pixel data` → 图像加载失败。
- 单帧文件（不带 ?frame=）无此问题（M0/M1 单帧验收通过）；5 帧文件 frame=0 显示正常、frame≥1 全挂。

## 修复方向（择优实现，需在代码里验证）
1. **推荐**：多帧展开时每个 frame 用**独立 imageId（不带 ?frame= 查询参数）**，即 `dcm-file://<uuid>-f<N>`，并在 NATURALIZED 元数据里按该 key 挂载（或共享同一 Part10 buffer 但用 `frame` 元数据区分）——与 @cornerstonejs/dicom-image-loader 对 wadouri 多帧的 imageId 惯例（`...&frame=N`）对齐，但**必须先弄清本仓库 loadImageFromNaturalizedMetadata 对 frame 参数的处理方式**（查 node_modules/@cornerstonejs/dicom-image-loader 与 metadata 的源码：naturalized 元数据是否包含 per-frame pixel data？`loadImageFromNaturalizedMetadata` 如何取像素？）。
2. 或者：多帧文件不再展开为多 imageId，而是**只建一个 imageId，靠 Cornerstone 的 frame 支持**（dicom-image-loader 原生支持多帧 imageId 的 ?frame 解码——但那是在解码层，NATURALIZED 元数据层要能提供对应帧数据）。
3. 如果 NATURALIZED 管线确实不支持多帧（上游限制），退路：多帧文件**按帧切分**——加载时用 dicom-parser 按帧提取每帧的像素构建多个单帧 imageId（内存可接受：每帧 512×512×2B ≈ 512KB），这样与现有单帧管线完全一致，最稳。

无论选哪条路，必须满足：**翻页时 canvas 内容随帧变化**（帧亮度不同时像素灰度不同）。

## 验证要求（真机验收由主 agent 执行，你只需）
1. **单元测试** `tests/m1.multiframe.test.ts`（或扩展现有）：
   - 构造 3 帧合成 DICOM buffer（测试助手已有 buildSyntheticDicom，可能需要加 NumberOfFrames 参数——看 `tests/helpers/syntheticDicom.ts`）
   - 断言：展开后生成 N 个 imageId；每个 imageId 的加载器路径能取到**对应帧**的像素（或至少：imageId 数量 = 帧数、每帧有独立可加载标识）
   - 如实现切帧方案：断言切出的每帧 buffer 尺寸 = 帧像素字节数
2. 既有 54 个测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error
3. 单独 commit：`fix(series): 多帧 DICOM 翻页显示对应帧`

## 输出
stdout 简报：根因确认、修复方案、改动文件、单测结果。
