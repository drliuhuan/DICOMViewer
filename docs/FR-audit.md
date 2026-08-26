# FR 需求差距审计报告（M10-A）

> 审计对象：`docs/需求清单.md`（v1.5，574 行）↔ `src/` 源码 + `tests/`（37 文件 / 272 用例）+ git 历史。
> 审计日期：2026-08-27 ｜ 基线 commit：`02f6112`（master，53 个 commit）。
> 结论基调：**M0/M1/M2/M7/M8/M9 为真实实现；M3(测量)/M4(MPR)/M5(3D) 仅有任务书无实现 commit；M6(分割/融合/导出) 仅存 README 占位**。用户 Web 界面「完全看不到三维重建和 MPR」与代码事实一致。

---

## 0. 审计范围与方法

- 通读全部需求文档 FR-1~FR-14（143 条编号需求 + FR-11 快捷键块）、NFR-1~11、AC-1~36、里程碑 §8、风险表、决策表。
- 通读 `src/` 全部 47 个 TS/TSX 文件与 `docs/` 历次任务书/验收报告；审阅 37 个测试文件（272 个 `it`）。
- 依据 git 历史核对：M0(M0核心)、M1(M1 缺陷修复×6)、M2(+fix1)、M7、M8、M9 有实现 commit；**M3/M4/M5 无实现 commit**；M6 仅 `f4c6913` 一次（只为 parseDicom 补 `frameOfReferenceUid/rescaleSlope/rescaleIntercept` 三个字段，分割/融合/导出未实现）。
- 本任务只审阅，**未改任何 src/ 代码**。

状态图例：✅ 完整＝该条需求已实现且有单测/代码证据；⚠️ 部分＝核心可用但缺子项或未验证；❌ 缺失＝无实现（仅占位/README/TODO）。

---

## 1. 总览表（模块级）

| FR 模块 | 状态 | 已实现条目 | 缺失/未实现条目 |
|---|---|---|---|
| FR-1 文件加载与 DICOM 解析 | ⚠️ 部分 | 1.1 1.2 1.3 1.4 1.5 1.6 1.8 1.10 1.11 | 1.7(部分) 1.9(部分) 1.12 1.13 1.14 1.15 1.16 1.17 |
| FR-2 序列与检查浏览 | ⚠️ 部分 | 2.1 2.2 2.3 2.4 2.7 2.8 2.9 | 2.5 2.6 2.10 |
| FR-3 2D 查看器 | ⚠️ 部分 | 3.1 3.2 3.3 3.4 3.6 3.7 3.11 3.18 | 3.5(部分) 3.12(部分) 3.16(部分) 3.8 3.9 3.10 3.13 3.14 3.15 3.17 3.19 |
| FR-4 信息显示（可开关） | ⚠️ 部分 | 4.1 4.10 | 4.2(部分) 4.3(部分) 4.4(部分) 4.5(部分) 4.6 4.7 4.8 4.9 |
| FR-5 测量与标注 | ❌ 缺失 | —（5 个工具仅占位注册） | 5.1~5.17 全部 |
| FR-6 MPR 多平面重建 | ❌ 缺失 | — | 6.1~6.10 全部 |
| FR-7 3D 体绘制 | ❌ 缺失 | — | 7.1~7.12 全部 |
| FR-8 分割（增强） | ❌ 缺失 | — | 8.1~8.6 全部 |
| FR-9 对比与融合（增强） | ❌ 缺失 | 9.1 部分（多视口并排，无联动） | 9.2 9.3 9.4 9.5 9.6 |
| FR-10 导出与保存 | ⚠️ 部分 | 10.6（PWA 离线壳） | 10.1 10.2 10.3 10.4 10.5 |
| FR-11 快捷键与工具栏 | ⚠️ 部分 | 翻页/工具切换/信息开关/布局/±/F/重置/Esc/速查表/输入框守卫/tooltip | L/A/R/O/C/Cine/Delete 占位；快捷键可配置(P2) 未做；光标形态未区分 |
| FR-12 设置 | ⚠️ 部分 | 12.2 12.3(部分) 12.5(部分) 12.7 | 12.1 12.4 12.6 |
| FR-13 PACS 联网 | ⚠️ 部分 | 13.1(DICOMweb) 13.2(DICOMweb) 13.3(QIDO) 13.4(WADO) 13.5(部分) 13.6(2D部分) 13.7(部分) 13.9(部分) | 13.8 13.10 13.11；网关/分页/IndexedDB 等 P1 子项 |
| FR-14 移动端适配 | ⚠️ 部分 | 14.1(部分) 14.2(部分) 14.3 14.4(部分) 14.7(部分) 14.9(部分) 14.10(部分) | 14.5 14.6 14.8 14.11 14.12 |

**统计**（143 条编号需求，逐条状态见 §2）：完整 ✅ 30 条 ｜ 部分 ⚠️ 26 条 ｜ 缺失 ❌ 87 条。若把 ⚠️ 视为"需补全"，则**未达标 87+26=113 条**；其中用户可见核心（MPR/3D/测量）共 39 条（FR-5/6/7）**全部缺失**。

---

## 2. 详细差距表（逐 FR 条目）

> 证据列为「代码/测试/commit」三选多；优先级为需求文档原始优先级（P0/P1/P2）。

### FR-1 文件加载与 DICOM 解析

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-1.1 打开单个文件 | ✅ | `src/features/loading/openDicomFiles.ts`、App 文件选择器+全窗拖拽（`App.tsx:393-447`、735-758）；测试 `m2.errorTolerance`、`smoke`；commit `3bb86d9` | 多选文件打开已支持 | P0 |
| FR-1.2 打开文件夹（递归） | ✅ | `directoryScan.ts`（showDirectoryPicker / webkitdirectory 一等路径）；测试 `m2.directoryScan`；commit `f9f181c` | 全浏览器（Chromium/Firefox/Safari）递归路径完整 | P0 |
| FR-1.3 拖拽文件夹 | ✅ | `directoryScan.ts scanDroppedItems`（webkitGetAsEntry 递归）+ `needsPickerFallback` 引导提示；测试 `m2.directoryScan` | | P0 |
| FR-1.4 非 DICOM 识别 | ✅ | `dicomFileFilter.ts`（扩展名黑名单）+ `parseDicom.ts NotDicomError` + `ErrorReportPanel`；测试 `m2.errorTolerance`、`m2.errorReport` | | P0 |
| FR-1.5 坏文件容错 | ✅ | `openDicomFiles.ts` 逐文件独立 + `ParseFailureError` + 错误列表；测试 `m2.errorTolerance` | | P0 |
| FR-1.6 解析进度反馈 | ✅ | `openDicomFiles.ts` onProgress/signal + App 进度条+取消；测试 `m2.progressCancel`；commit `5500302` | | P0 |
| FR-1.7 传输语法 | ⚠️ | 解码走 dicom-image-loader Worker（`init.ts:22-28`）；wasm codec 已随包（`node_modules/@cornerstonejs/codec-openjpeg|codec-charls|codec-libjpeg-turbo-8bit|codec-openjph`，dist 含对应 wasm 产物）；无专项测试 | 隐式 VR/显式 VR/Deflated/JPEG 系列/JPEG2000/JPEG-LS/RLE 依赖 loader 内置管线，**无显式声明与回归测试**；HTJ2K(openjph) 为 P2 且无验证 | P0 |
| FR-1.8 多帧文件 | ✅ | `buildStacks.ts` `?frame=N` 展开；`parseDicom.ts` 增强型多帧 Per-frame FG 逐帧位置解析（`extractPerFrameImagePositions`）；`imageId.ts` 逐帧拆像素；测试 `m1.multiframe`、`m2.metadataHierarchy`、`m2.sorting`；commit `f7fd65f`、`79d8ba2` | | P0 |
| FR-1.9 像素类型 | ⚠️ | `pixelProbe.ts samplePixel` 支持 RGB；`parseDicom.ts` 提取 Rows/Cols/BitsAllocated；缩略图仅灰度 16bit 未压缩单通道 | MONOCHROME1 自动反相映射未实现；32 位浮点无路径测试；YBR→RGB / Planar / Palette Color 依赖 loader 默认行为，未显式处理与测试 | P0 |
| FR-1.10 元数据层级 | ✅ | `parseDicom.ts DicomInstanceSummary`（患者→检查→序列→实例四级）+ `seriesTree.ts`；commit `f7fd65f`、`cb186af`；测试 `m2.metadataHierarchy` | | P0 |
| FR-1.11 文件去重 | ✅ | `dedupe.ts`（跨批次 SOPInstanceUID 去重）；commit `55b2c7c`；测试 `m2.dedupe` | | P1 |
| FR-1.12 元数据持久缓存 | ❌ | `src/` 无 IndexedDB 缓存实现（localforage 未安装） | P2，可缓 | P2 |
| FR-1.13 ZIP 压缩包 | ❌ | 无 | P2，可缓 | P2 |
| FR-1.14 示例数据 | ❌ | `public/README.md` 声明为空占位 | **需求已降级**（用户提供真实数据集），可不做 | P2 |
| FR-1.15 URL/HTTP 加载 | ❌ | 无 `?dicom=` / URL 输入入口（仅 PACS WADO 拉取，非此条） | P1，见 FR-13/施工顺序 | P1 |
| FR-1.16 DICOM Overlay | ❌ | 无 60xx 解析显示 | P2 | P2 |
| FR-1.17 DICOMDIR | ❌ | 无 | P2 | P2 |

### FR-2 序列与检查浏览

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-2.1 树形导航 | ✅ | `seriesTree.ts` + `SeriesPanel.tsx`（患者→检查→序列树）；commit `cb186af`；测试 `m2.metadataHierarchy`、`m2.seriesPanel`、`m7.virtualList`（≥24 序列窗口化虚拟列表） | | P0 |
| FR-2.2 序列信息展示 | ✅ | `SeriesPanel.tsx` 卡片（模态/描述/层数/矩阵/像素间距/层厚）；测试 `m2.seriesPanel` | | P0 |
| FR-2.3 实例排序 | ✅ | `buildStacks.ts compareInstances`（InstanceNumber→SliceLocation→IPP 法向量投影→文件名）；测试 `m1.buildStacks`、`m2.sorting`；commit `81b9cad` | | P0 |
| FR-2.4 序列缩略图 | ✅ | `thumbnails.ts`（首帧+LRU+分批）+App 集成；测试 `m2.thumbnails`、`m7.thumbnailsBatch`；commit `04adb8f` | MIP 缩略图(P2) 未做；压缩语法/彩色像素缩略图未支持（回退占位图标） | P1 |
| FR-2.5 搜索过滤 | ❌ | `SeriesPanel.tsx` 无搜索框 | P1 | P1 |
| FR-2.6 多选序列 | ❌ | 无勾选进入对比/融合模式 | P1 | P1 |
| FR-2.7 患者维度分组 | ✅ | `seriesTree.ts` 同患者多次检查并列（随访对比）；测试 `m2.metadataHierarchy`、`m2.seriesPanel` | | P1 |
| FR-2.8 序列加载交互 | ✅ | 单击→激活视口、拖拽卡片→指定视口、视口角标；`App.tsx` / `ViewerCell.tsx` / `seriesDragDrop.ts`；commit `f1ddeee`、`eb524c8`；测试 `m1.seriesDragDrop`、`m1.multiViewport` | 「双击加载到指定视口」语义已按五轮评审改为「双击=适应窗口」（`DicomViewport.tsx:412-428`），拖拽到指定视口保留 | P0 |
| FR-2.9 数据集关闭与清空 | ✅ | `release.ts releaseSeries/releaseAll` + App `closeSeries/clearAll`（二次确认）+ 视口 `removeAllActors` 清空；commit `91936e3`、`7677def`；测试 `m2.release`、`m2.closeClear`、`m2.viewportClear` | MPR/3D 资源释放随 FR-7.12 一并未实现 | P0 |
| FR-2.10 DICOM Tag 浏览器 | ❌ | 无 | P1 | P1 |

### FR-3 2D 查看器

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-3.1 灰度映射 | ✅ | `DicomViewport.tsx` `setProperties({voiRange})` + Modality LUT（`pixelProbe.ts`，CT 显示 HU）；测试 `m1.info` | 依赖 dicom-image-loader 默认 Modality LUT 管线 | P0 |
| FR-3.2 窗宽窗位调节 | ✅ | `WindowLevelTool` 左键（`toolSetup.ts`）+ WW/WL 输入框提交（`App.tsx:826-860`） | 拖动本身无独立集成测试（仅绑定/预设测试） | P0 |
| FR-3.3 窗宽窗位预设 | ✅ | `wwPresets.ts`（脑80/40、肺1500/-600、骨2500/500、软组织400/40、MR默认400/40）；测试 `m1.wwPresets` | MR 自动推荐只做了 CT/MR 默认档 | P0 |
| FR-3.4 窗宽窗位重置 | ✅ | `resetWindowLevel` + 双击/触控双击=适应窗口；测试 `m9.doubleTap` | | P0 |
| FR-3.5 缩放 | ⚠️ | Ctrl+滚轮缩放、适应窗口、1:1、缩放步进（+/-）；`DicomViewport.tsx` | **框选缩放工具（ZoomBox）未实现** | P0 |
| FR-3.6 平移 | ✅ | `PanTool` 中键拖动+作为主工具左键激活；测试 `m1.toolgroup`、`m1.toolsync` | 「空格+左键」备用绑定未提供 | P0 |
| FR-3.7 翻页/帧切换 | ✅ | 按钮、PageUp/Down/←→、滚轮翻页（默认）、层滑块、显示「第 X/N 层」 | | P0 |
| FR-3.8 Cine 播放 | ❌ | `shortcuts.ts cinePlaceholder`（App toast「Cine 播放将在后续里程碑提供」）；测试 `m7.shortcuts` 断言占位 | P1 | P1 |
| FR-3.9 旋转/翻转 | ❌ | 无 rotate/flip 实现 | P1 | P1 |
| FR-3.10 反色 | ❌ | 无 invert（MONOCHROME1 反相亦未做，见 FR-1.9） | P1 | P1 |
| FR-3.11 视图重置 | ✅ | `resetView`（Shift+R，WW/WL+缩放+平移） | | P0 |
| FR-3.12 多视口布局 | ⚠️ | `App.tsx LAYOUT_CONFIG`：1×1/1×2/2×2 + 快捷键 1/2/4 | **3×3 与自定义分割未实现** | P0 |
| FR-3.13 视口同步 | ❌ | 无跨视口 WW/WL/缩放/平移/翻页联动（`m1.toolsync` 测的是工具绑定同步，非视口同步） | P1 | P1 |
| FR-3.14 双序列同屏 | ❌ | 无同一视口区域并排/上下对比 | P1 | P1 |
| FR-3.15 定位线/参考线 | ❌ | `shortcuts.ts crosshairPlaceholder` 占位（C 键 toast「MPR 定位线将在后续里程碑提供」） | P1 | P1 |
| FR-3.16 性能 | ⚠️ | 解码 Web Worker ✓（`init.ts`）；ResizeObserver 布局重排优化（`DicomViewport.tsx:356-386`） | **500 层≤100ms 无基准测试**；NFR 指标未建立 | P0 |
| FR-3.17 放大镜 | ❌ | Loupe 未实现 | P2 | P2 |
| FR-3.18 层滑块 | ✅ | `DicomViewport.tsx:548-589`（第 X/N 层 + range） | | P1 |
| FR-3.19 全屏模式 | ❌ | Fullscreen API 未使用 | P2 | P2 |

### FR-4 信息显示（可开关）

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-4.1 全局开关 | ✅ | `I` 键 + 工具栏按钮（`App.tsx`） | 截图选项开关（FR-4.9）随截图缺失 | P0 |
| FR-4.2 患者信息 | ⚠️ | `InfoOverlay.tsx`（姓名/ID/性别/年龄） | **脱敏选项（"张**"）未实现** | P0 |
| FR-4.3 检查信息 | ⚠️ | `InfoOverlay.tsx`（日期/描述/机构） | **检查号未显示** | P0 |
| FR-4.4 序列信息 | ⚠️ | `InfoOverlay.tsx`（模态/层号/层数/层厚/矩阵） | **FOV 未显示** | P0 |
| FR-4.5 像素信息 | ⚠️ | `DicomViewport.tsx` 光标采样 + `InfoOverlay`（px 坐标/灰度HU/WW/WL/缩放%） | **物理 mm 坐标未显示** | P0 |
| FR-4.6 显示项配置 | ❌ | 设置面板无覆盖文字显隐项 | P1（与 FR-12.4 同） | P1 |
| FR-4.7 样式配置 | ❌ | 无字号/颜色/位置/描边配置 | P1 | P1 |
| FR-4.8 比例尺 | ❌ | 无 scalebar | P1 | P1 |
| FR-4.9 截图含文字 | ❌ | 截图功能（FR-10.1）未实现 | P1 | P1 |
| FR-4.10 解剖方向标记 | ✅ | `orientation.ts computeOrientationMarkers` + `InfoOverlay` 四边标签；测试 `m1.info` | 旋转/翻转功能未实现，**「随视图旋转更新」无法验证**（旋转落地后需联动） | P0 |

### FR-5 测量与标注（模块级 ❌）

> 共同证据：`toolSetup.ts:70-97` `PLACEHOLDER_MEASUREMENT_TOOLS`（Length/Angle/RectangleROI/EllipticalROI/Probe 仅全局注册占位、不绑定主工具）+ `App.tsx:511-525,649-651` 激活拦截「该测量工具在 M3 提供」+ `shortcuts.ts` `placeholderMeasurement`/`deleteAnnotationPlaceholder`；测试 `m1.shortcuts`/`m1.toolgroup`/`m7.shortcuts` 显式断言占位动作。

| 编号 | 状态 | 缺口说明 | 优先级 |
|---|---|---|---|
| FR-5.1 长度测量 | ❌ | 无两点连线/物理 mm/端点拖动/样式配置 | P0 |
| FR-5.2 角度测量 | ❌ | | P0 |
| FR-5.3 矩形 ROI | ❌ | 无均值/标准差/极值/面积/像素数 | P0 |
| FR-5.4 椭圆 ROI | ❌ | | P0 |
| FR-5.5 徒手 ROI | ❌ | | P1 |
| FR-5.6 点/箭头/文本标注 | ❌ | | P1 |
| FR-5.7 ROI 统计实时更新 | ❌ | 统计须用 Modality LUT 后原始值（决策 §7.3-5） | P0 |
| FR-5.8 像素间距缺失处理 | ❌ | 无「无法计算物理尺寸」+ 手动校准 | P0 |
| FR-5.9 标注管理面板 | ❌ | 仅 `deleteAnnotationPlaceholder`；无列表/选中/跳转/显隐/批量删除 | P1 |
| FR-5.10 标注-帧关联 | ❌ | 无标注数据模型 | P1 |
| FR-5.11 标注导入导出 | ❌ | | P1 |
| FR-5.12 DICOM SR 导出 | ❌ | dcmjs 仅作传递依赖、未直接使用 | P1 |
| FR-5.13 测量精度 | ❌ | – | P0 |
| FR-5.14 吸附/捕捉 | ❌ | | P2 |
| FR-5.15 MPR/3D 上测量 | ❌ | 依赖 FR-6/7 | P1 |
| FR-5.16 撤销/重做 | ❌ | | P2 |
| FR-5.17 ROI 直方图 | ❌ | | P2 |

### FR-6 MPR 多平面重建（模块级 ❌）

> 共同证据：`src/` 无任何 `VolumeViewport`/`createAndCacheVolume`/`CrosshairTool` 代码（grep 全仓零命中 vtk/volume）；仅 `shortcuts.ts crosshairPlaceholder` + `HelpOverlay` 占位行。任务书 `docs/task-m10-mpr.md` 已规划施工路径。

| 编号 | 状态 | 缺口说明 | 优先级 |
|---|---|---|---|
| FR-6.1 三平面显示 | ❌ | 无 VolumeViewport | P0 |
| FR-6.2 交叉定位线 | ❌ | 无 Crosshair/ReferenceLines | P0 |
| FR-6.3 三平面联动 | ❌ | | P0 |
| FR-6.4 厚度模式 | ❌ | 无 Average/MIP/MINIP+厚度滑杆 | P1 |
| FR-6.5 斜切 MPR | ❌ | | P1 |
| FR-6.6 基础操作继承 | ❌ | MPR 视口无 WW/WL/缩放/平移/测量 | P0 |
| FR-6.7 数据要求与提示 | ❌ | 无 mprGate（<2 层/无间距/无 IPP 禁用+原因） | P0 |
| FR-6.8 重建性能 | ❌ | | P0 |
| FR-6.9 布局切换 | ❌ | 无「单轴向⇄三平面」一键切换 | P1 |
| FR-6.10 参考线随动 | ❌ | 2D 单视口无 MPR 平面指示 | P1 |

### FR-7 3D 体绘制（模块级 ❌）

> 共同证据：`src/` 无 vtk / `ViewportType.VOLUME_3D` / 预设代码；`node_modules/@cornerstonejs/core@5.8.2` 已内置 `VolumeViewport3D`/`GenericVolumeViewport3D`（`dist/esm/index.js` export）；vtk.js 36.4.1 为 core 直接依赖（打包入 cornerstone chunk）。任务书 `docs/task-m10-3d.md` 已规划。

| 编号 | 状态 | 缺口说明 | 优先级 |
|---|---|---|---|
| FR-7.1 体绘制渲染 | ❌ | CPR 无；需显式 `registerViewportType` + 能力检测 | P0 |
| FR-7.2 渲染预设 | ❌ | 无 CT-Bone/Angio/Soft-Tissue/Skin/MIP 预设表（需 vtk 颜色/不透明度传递函数） | P0 |
| FR-7.3 窗宽窗位联动 | ❌ | | P1 |
| FR-7.4 裁剪平面 | ❌ | | P1 |
| FR-7.5 六面裁剪盒 | ❌ | | P2 |
| FR-7.6 渐进式渲染 | ❌ | | P1 |
| FR-7.7 质量档位 | ❌ | | P1 |
| FR-7.8 3D 截图 | ❌ | | P1 |
| FR-7.9 复位视角 | ❌ | | P0 |
| FR-7.10 等值面重建 | ❌ | | P2 |
| FR-7.11 与 2D 联动 | ❌ | | P2 |
| FR-7.12 内存释放 | ❌ | GPU 纹理释放未实现（release.ts 仅治理 imageId 注册表） | P1 |

### FR-8 分割（增强）（模块级 ❌）

> 共同证据：`src/features/segmentation/` 仅 `README.md`（"阈值分割、彩色叠加、统计与导出 NRRD/STL/SEG。计划里程碑：M6"），无任何代码。

| 编号 | 状态 | 缺口说明 | 优先级 |
|---|---|---|---|
| FR-8.1 阈值分割 | ❌ | | P1 |
| FR-8.2 分割叠加显示 | ❌ | | P1 |
| FR-8.3 分割统计 | ❌ | | P1 |
| FR-8.4 分割编辑 | ❌ | | P2 |
| FR-8.5 分割导出 | ❌ | NRRD/STL/DICOM SEG 三格式均无 | P1 |
| FR-8.6 多标签分割 | ❌ | | P2 |

### FR-9 对比与融合（增强）

> 共同证据：`src/features/fusion/` 仅 `README.md`。前置字段 `frameOfReferenceUid` 已在 `parseDicom.ts` 解析（commit `f4c6913`）。

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-9.1 多序列并排对比 | ⚠️ | 多视口各自加载序列+独立 WW/WL（`App.tsx` assignments；测试 `m1.multiViewport`） | 独立窗宽窗位 ✓；**联动 ✗** | P1 |
| FR-9.2 同步联动 | ❌ | FoR 字段已解析但无联动逻辑/UI | 无 SyncTool；FoR 不一致提示未做 | P1 |
| FR-9.3 棋盘格模式 | ❌ | | | P2 |
| FR-9.4 图像融合 | ❌ | FoR 前提字段已就绪 | 无 PET+CT 叠加/透明度滑块/色表 | P1 |
| FR-9.5 融合色表 | ❌ | | | P1 |
| FR-9.6 PET SUV | ❌ | `node_modules/@cornerstonejs/calculate-suv` 存在但未使用 | 需依赖剂量标签（RadiopharmaceuticalInformationSequence） | P2 |

### FR-10 导出与保存

> 共同证据：`src/features/export/` 仅 `README.md`。截图可复用 cs3d 视口 API 但未接。

| 编号 | 状态 | 缺口说明 | 优先级 |
|---|---|---|---|
| FR-10.1 视口截图 PNG | ❌ | 无 capture/toBlob；含/不含覆盖文字选项未做 | P0 |
| FR-10.2 全布局截图 | ❌ | | P1 |
| FR-10.3 测量导出 CSV/JSON | ❌ | 依赖 FR-5 | P1 |
| FR-10.4 会话恢复 | ❌ | 无 IndexedDB 句柄/布局/预设恢复 | P2 |
| FR-10.5 原始文件另存 | ❌ | | P2 |
| FR-10.6 PWA 安装与离线 | ✅ | `public/manifest.webmanifest`+`public/sw.js`（预缓存壳/网络优先离线回退）+`src/pwa/register.ts`；测试 `m7.pwa`（沙箱执行真实 sw.js）；commit `703c444` | | P1 |

### FR-11 快捷键与工具栏

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-11 快捷键映射 | ⚠️ | `shortcuts.ts resolveShortcut` + `App.tsx` keydown + `HelpOverlay` 速查表；测试 `m1.shortcuts`、`m7.shortcuts`、`m7.help` | 已绑：I/W/Z/P/F/±/1/2/4/PageUp/Down/←→/Shift+R/Esc；**占位**：L/A/R/O(测量)、Space(Cine)、C(十字线)、Delete(删标注)。布局快捷键仅 1/2/4（需求 1~9）；快捷键可配置(P2) 未做；测量工具光标形态未区分 | P0（核心项）/P2(可配置) |
| FR-11 输入框聚焦守卫 | ✅ | `isTextInputTarget`；测试 `m1.shortcuts` | | P0 |
| FR-11 工具栏 tooltip | ✅ | 全部按钮含 `title` | | P0 |

### FR-12 设置

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-12.1 窗宽窗位预设管理 | ❌ | `wwPresets.ts` 为只读常量表 | 无新增/编辑/删除自定义预设 UI | P1 |
| FR-12.2 主题 | ✅ | `settings.ts applyTheme`（`<html data-theme>`，默认深色）；测试 `m7.settings` | | P1 |
| FR-12.3 语言 | ⚠️ | `i18n.tsx` + `zh.ts`（默认中文）；测试 `m7.i18n` | **en 词典为骨架**；存量组件文案（SeriesPanel/ErrorReportPanel/InfoOverlay/进度条/toast/状态栏）未迁入词典 | P1 |
| FR-12.4 覆盖文字配置 | ❌ | 同 FR-4.6/4.7 | P1 | P1 |
| FR-12.5 性能模式 | ⚠️ | 图像缓存上限/缩略图 LRU 上限可调（`settings.ts` + `deviceProfile` 低内存降级） | 高画质档位未做 | P2 |
| FR-12.6 单位与精度 | ❌ | | P2 | P2 |
| FR-12.7 重置设置 | ✅ | `SettingsPanel` 重置；测试 `m7.settings` | | P1 |

### FR-13 PACS 联网

> 共同证据：`config.ts`/`dicomweb.ts`/`remoteInstances.ts`/`PacsPanel.tsx` 均为**真实实现**（非占位）；commit `baad44e`、`d614f18`（M8 检查点）。**注意：M8 无对应测试文件**（tests/ 无 m8.*）。

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-13.1 服务器配置管理 | ⚠️ | `config.ts`（多 DICOMweb 服务器增删改/默认/校验，localStorage `dicom-viewer.pacs.v1`） | **传统 DICOM 网关配置（AE Title 等）未实现**（`TODO(FR-13.1,P1)`）；持久化为 localStorage（`TODO(FR-13.1,P2)` 应改 IndexedDB） | P1 |
| FR-13.2 连接测试 | ⚠️ | `dicomweb.ts testConnection`（空 QIDO limit=1） | C-ECHO 网关路径未实现（`TODO(P2)`） | P1 |
| FR-13.3 检索查询 | ⚠️ | `qido` 三级查询（studies/series/instances，limit=200） | **分页未实现**（`TODO(FR-13.3,P1)`）；C-FIND 未实现 | P1 |
| FR-13.4 拉取检查/序列 | ⚠️ | `retrieveStudy` 逐实例批量+进度+取消+重试 | **超大检查按序列分批/帧懒加载未实现**（`TODO(FR-13.4,P1)`）；C-MOVE 未实现 | P1 |
| FR-13.5 远程数据生命周期 | ⚠️ | `remoteInstances.ts`（内存缓冲+`remoteSource` 来源标记，受 release 管） | IndexedDB 可选缓存/LRU 上限未做（`TODO(FR-13.5,P1)`） | P1 |
| FR-13.6 远程数据全功能可用 | ⚠️ | 拉取实例与本地共用 buildSeriesStacks→2D 阅片 ✓ | MPR/3D/测量/导出与 FR-6/7/5/10 同缺 | P1 |
| FR-13.7 认证与凭据 | ⚠️ | `config.authHeaderName/Value` 整串附加（Basic/Bearer 均可用）；401/403 归入 DicomwebError | **凭据明文持久化于 localStorage**（需求为「内存默认+用户确认后 IndexedDB」，属安全偏差，见 NFR-7）+ 重新登录入口未做 | P1 |
| FR-13.8 隐私与审计 | ❌ | 无审计日志 | P2 | P2 |
| FR-13.9 错误与异常处理 | ⚠️ | `DicomwebError`（network/http/timeout/parse/auth/cancelled）+ `mixedContentWarning` + 服务器不可达不阻塞本地 | 修复指引 UI（如 401 重新登录）部分缺失 | P1 |
| FR-13.10 网关部署配套 | ❌ | 仅 README 提及「可选网关」 | **无 gateway/ 组件与部署文档（含 TLS/自签证书指引）** | P1 |
| FR-13.11 与 URL 加载统一 | ❌ | FR-1.15 未实现，统一模型无从谈起 | P2 | P2 |

### FR-14 移动端适配

> 共同证据：`touchEvents.ts`/`toolSetup.ts`（双指绑定）/`deviceProfile.ts`/`mobileFileAccess.ts`/`useMediaQuery.ts`；测试 `m9.*` 全套；commit `04e9992`（276 测试全绿）。

| 编号 | 状态 | 证据 | 缺口说明 | 优先级 |
|---|---|---|---|---|
| FR-14.1 触控手势映射 | ⚠️ | 单指=主工具（`numTouchPoints:1`）、双指=Zoom 捏合缩放+平移（`numTouchPoints:2`）、双击=适应窗口；测试 `m9.touchGestures`、`m9.doubleTap` | **双指 WW/WL、双指旋转、长按防误触未实现**（`toolSetup.ts:27-28 TODO(FR-14.1)`） | P1 |
| FR-14.2 响应式布局 | ⚠️ | ≤767px 序列抽屉（`m9.mobile`）；视口网格自适应 | 工具栏溢出菜单、`safe-area-inset`、横屏自动阅片未做 | P1 |
| FR-14.3 移动端文件打开 | ✅ | `mobileFileAccess.ts`（Android webkitdirectory ✓；iOS 多选+PACS/URL 引导提示 ✓）；测试 `m9.mobileFileAccess`、`m9.mobile` | iPadOS UA 边缘漏判（代码 TODO） | P1 |
| FR-14.4 移动端性能自适应 | ⚠️ | `deviceProfile.ts`（低内存降级缓存上限 1/4、缩略图减半）；测试 `m9.deviceProfile`、`m9.mobile` | 默认低画质档位、大体积懒加载分批、内存吃紧提示未做（`TODO(FR-14.4)`） | P1 |
| FR-14.5 移动端 3D 降质 | ❌ | 3D 整体未实现；WebGL2 能力检测未做 | P1 |
| FR-14.6 触控测量与标注 | ❌ | 测量未实现；44px 命中区未精调；破坏性操作二次确认仅在「清空全部」 | P1 |
| FR-14.7 PWA 移动端 | ⚠️ | standalone/图标（any+maskable）/apple-touch-icon/iOS meta（`m9.pwaIcons`） | **启动画面（apple-touch-startup-image）未做**（`register.ts TODO(FR-14.7)`） | P1 |
| FR-14.8 信息显示移动端 | ❌ | 无字号自适应/状态栏折叠；方向标记随覆盖开关隐藏（需求「始终可见」未满足） | P2 |
| FR-14.9 触控与滚动协调 | ⚠️ | 手势由工具层吞掉（绕过页面滚动）；列表原生滚动天然成立 | 视口全屏时禁用滚动无可验证对象（无全屏功能） | P1 |
| FR-14.10 移动端输入适配 | ⚠️ | WW/WL 用 `type=number`（唤起数字键盘） | min-height 44px 未强制 | P2 |
| FR-14.11 横竖屏与旋转 | ❌ | 横屏自动阅片未做（`App.tsx:19 TODO(FR-14.11)`）；旋转状态保持未验证 | P2 |
| FR-14.12 移动端性能目标 | ❌ | 无移动端 150ms/250ms/8fps 基准与测量 | P1 |

---

## 3. 非功能需求（NFR）差距

| 编号 | 类别 | 状态 | 说明 |
|---|---|---|---|
| NFR-1 | 性能-打开 | ⚠️ | 部分优化（缩略图分批/虚拟列表）已做；**500 层 5s 无基准测试** |
| NFR-2 | 性能-交互 | ⚠️ | 解码 Worker 已做；**帧切换≤100ms、WW/WL≥30fps、MPR≤150ms 无基准** |
| NFR-3 | 性能-3D | ❌ | 3D 未实现 |
| NFR-4 | 性能-内存 | ⚠️ | LRU 缓存上限可调+低内存模式+序列释放 ✓；**500MB≤1.5GB 未验证**；MPR/3D/GPU 释放随 FR-7.12 缺失 |
| NFR-5 | 兼容性 | ⚠️ | 决策落地（webkitdirectory/拖拽一等路径）；**Firefox/Safari 真实回归未做**（无 Playwright E2E） |
| NFR-6 | 可靠性 | ⚠️ | 坏文件/截断容错 ✓、全局错误捕获（App loadState/renderError）✓；**>2GB 单文件提示未做** |
| NFR-7 | 隐私安全 | ⚠️ | 本地零网络（无埋点）✓；**PACS 凭据明文持久化 localStorage**（与需求不符）；无审计（FR-13.8） |
| NFR-8 | 可维护性 | ⚠️ | TS 全量严格类型 ✓、模块分层 ✓、核心算法单测覆盖高（272 用例）✓；**Playwright E2E 零实现**、≥80% 覆盖未度量 |
| NFR-9 | 国际化 | ⚠️ | i18n 框架+默认中文 ✓；**en 词典骨架、存量文案未迁入** |
| NFR-10 | 可访问性 | ⚠️ | 部分 aria-label/键盘操作 ✓；**WCAG AA 未审计** |
| NFR-11 | 部署 | ✅ | 静态产物+PWA（manifest/sw 离线壳）已具备；dist/ 已有构建产物；HTTPS 就绪 |

---

## 4. 验收标准（AC）对照

| AC | 状态 | 说明 |
|---|---|---|
| AC-1 文件夹+非DICOM跳过+序列树 | ✅ | m2.directoryScan/errorReport/seriesPanel |
| AC-2 500层翻页≤100ms | ⚠️ | 功能可用；性能未实测 |
| AC-3 按`I`开关覆盖文字+截图 | ⚠️ | `I` ✓；截图开关依赖 FR-10.1（未做） |
| AC-4 CT 预设+拖动+输入框 | ✅ | |
| AC-5 长度测量 mm | ❌ | FR-5.1 |
| AC-6 角度测量 | ❌ | FR-5.2 |
| AC-7 矩形 ROI 均质校验 | ❌ | FR-5.3 |
| AC-8 三平面 MPR 联动≤150ms | ❌ | FR-6 |
| AC-9 3D CT-Bone 预设旋转 | ❌ | FR-7 |
| AC-10 标注 JSON 导出再导入 | ❌ | FR-5.11 |
| AC-11 DICOM SR 解析 | ❌ | FR-5.12 |
| AC-12 阈值分割+3D 叠加 | ❌ | FR-8 |
| AC-13 本地零网络 | ✅ | 架构成立（无埋点/无外发） |
| AC-14 截断文件不崩溃+报告 | ✅ | m2.errorTolerance |
| AC-15 双序列并排+同步 WW/WL | ⚠️ | 并排独立 WW/WL ✓（多视口）；同步 ✗（FR-3.13） |
| AC-16 真实 CT 全流程（含 MPR/3D） | ❌ | MPR/3D 缺失 |
| AC-17 Firefox/Safari 等价 | ⚠️ | 架构路径在；真实浏览器未回归 |
| AC-18 `?dicom=` URL 加载 | ❌ | FR-1.15 |
| AC-19 HTTPS PWA 断网打开 | ✅ | m7.pwa（沙箱验证 sw） |
| AC-20 DICOM SEG 导出 | ❌ | FR-8.5 |
| AC-21 旋转后方向标签更新 | ⚠️ | 标签计算 ✓；旋转未实现无从验证 |
| AC-22 2×2 双击加载指定视口 | ⚠️ | 拖拽到指定视口 ✓；双击语义已改为「适应窗口」（五轮评审） |
| AC-23 DICOMweb 配置+测试+持久化 | ⚠️ | DICOMweb 路径 ✓（localStorage 持久化重启仍在）；C-ECHO ✗ |
| AC-24 QIDO 患者+日期+分页 | ⚠️ | QIDO 查询 ✓；分页 ✗ |
| AC-25 拉取检查+远程标记+全功能 | ⚠️ | 拉取/进度/远程标记/2D ✓；测量/MPR ✗ |
| AC-26 网关 C-ECHO/FIND/MOVE | ❌ | FR-13.10 网关缺失 |
| AC-27 停服后错误提示+本地不受影响 | ✅ | DicomwebError + 本地模式独立 |
| AC-28 iPad 单指/双指手势 | ⚠️ | 单指平移、双指缩放 ✓；双指 WW/WL ✗ |
| AC-29 Android 文件夹/iOS 多选+引导 | ✅ | m9.mobileFileAccess/m9.mobile |
| AC-30 中端手机 200 层≤150ms | ⚠️ | 缓存降级 ✓；性能未实测 |
| AC-31 主屏幕独立窗口 | ⚠️ | standalone/图标 ✓；启动画面 ✗ |
| AC-32 竖屏→横屏布局切换+状态保持 | ❌ | FR-14.11 未做 |
| AC-33 PET+CT 融合+FoR 前置提示 | ❌ | FR-9.4；FoR 字段已解析作前置 |
| AC-34 Cine 调速+滑块双向同步 | ❌ | FR-3.8/3.18（滑块已可拖动定位，Cine 缺） |
| AC-35 缺失间距手动校准后测量 | ❌ | FR-5.8 |
| AC-36 混合内容明确提示 | ⚠️ | `mixedContentWarning` 已实现；完整 UI 级修复指引部分 |

**AC 统计**（36 条）：✅ 7（AC-1,4,13,14,19,27,29）｜ ⚠️ 13 ｜ ❌ 16。无对应实现的 AC（全部 ❌ 项）即后续验收主标的。

---

## 5. 关键地基审阅（task 指定要点）

### 5.1 imageId 方案 → Volume 构建可行性（FR-6/FR-7 地基）

**现状链路**（已核实源码）：
- imageId scheme = `dcm-file://<key>`（`src/dicom/imageId.ts:17`），多帧追加 `?frame=N`（`withFrameNumber`）。
- `ensureDcmFileMetadata`（`imageId.ts:234-252`）调 `utilities.addDicomPart10Instance(baseImageId, buffer)` 把完整 Part-10 挂到 `@cornerstonejs/metadata` 的 **NATURALIZED** 元数据存储，并做逐帧拆像素（`splitNaturalizedPixelDataIntoFrames`）。
- `src/dicom/init.ts` 仅做：core init + 注册 loader + decode worker 池；**尚未注册 volumeLoader**。
- 解析层 `parseDicom.ts`（`extractInstanceSummary`）已提取 volume 所需全部原始字段：`imagePositionPatient`(0020,0032)、`imageOrientationPatient`(0020,0037)、`pixelSpacing`(0028,0030)、`sliceThickness`(0018,0050)、`numberOfFrames`(0028,0008)、`perFrameImagePositions`（增强多帧）、`rescaleSlope/Intercept`(0028,1053/1052)、`frameOfReferenceUid`(0020,0010)。

**结论：元数据 provider 已具备（可直接支撑 createAndCacheVolume），但有 4 个待补点**：

1. **NATURALIZED → 标准模块自动桥接已内建且运行时生效**：`@cornerstonejs/metadata` registerDefaultProviders（`registerDefaultProviders.js:20-40`）安装 `dataLookup`/`tagModules` 桥接——`metaData.get(IMAGE_PLANE, imageId)` 与 `IMAGE_PIXEL`、`SCALING` 等会**从已挂的 NATURALIZED 实例自动派生**（含 IPP/IOP/PixelSpacing/SliceThickness/Rows/Cols/BitsAllocated/Rescale）。该桥接在本项目运行时**已经生效**：`src/dicom/init.ts:22-28` 调 `initDicomImageLoader` → `registerLoaders`（`dicom-image-loader/dist/esm/imageLoader/registerLoaders.js`）→ `wadouriRegister` → `registerDefaultProviders()`。因此 `core` 内置 `generateVolumePropsFromImageIds → sortImageIdsAndGetSpacing`（`core/dist/esm/utilities/sortImageIdsAndGetSpacing.js`）所需的 IMAGE_PLANE 元数据**已经可查**。
2. **须先对所有 imageId 预热元数据**：`ensureDcmFileMetadata` 目前只在图像解码时惰性调用；`createAndCacheVolume` 在加载前就会查询 IMAGE_PLANE。施工时应在建 volume 前对序列全部 imageId 循环 `ensureDcmFileMetadata`（幂等，已有的 `registeredBaseImageIds` 会去重）。
3. **增强多帧逐帧 IPP 需单独桥接**：多帧 `?frame=N` 经 base-image-id 过滤器查到的是**实例级 IPP**（同一值），各帧投影相同 → 对增强型多帧，volume 的 z 排序会用错。`parseDicom.ts` 已解析 `perFrameImagePositions`（增强多帧时有序号），施工需注册一个 per-frame `IMAGE_PLANE` provider（对 `?frame=N` 用 `perFrameImagePositions[N-1]` 覆盖 IPP）。注意：`buildStacks.ts orderedFrameNumbers` 已按投影排好帧序并用于 2D 堆栈，但 volume loader 会**内部重新按元数据排序**，故仍必须补此 provider（或预排序 imageIds 使 loader 的排序结果一致）。
4. **层间距不一致（FR-6.7）/ 缺失 PixelSpacing / SliceThickness**：`sortImageIdsAndGetSpacing` 从相邻 IPP 差求 z-spacing（无 SliceThickness 也能算几何）；但**非均匀间距的重采样提示与处理、PixelSpacing 缺失的禁用判定，全部要由 mprGate 实现**（详见 `docs/task-m10-mpr.md` 数据门槛）。

`NumberFrames/多帧展开`：无缺口，imageIds 已含 `?frame=N`，volume loader 按 imageIds 数组逐个 frame 取回。

### 5.2 vtk.js 是否需要显式安装（3D 施工，FR-7）

- `@kitware/vtk.js@36.4.1` 已是 `@cornerstonejs/core@5.8.2` 的**直接依赖**（`core/package.json:89`），打包已进 cornerstone chunk（dist 中 cornerstone chunk 含 vtk，~2.97MB）。
- core 5.8.2 已导出 3D 相关 API：`VolumeViewport3D`/`GenericVolumeViewport3D`/`registerViewportType`/`setVolumesForViewports`（`core/dist/esm/index.d.ts:119`）。**MPR（VolumeViewport）完全不需要单独装 vtk**——它由 core 内部 vtk 支撑。
- FR-7.2 渲染预设需要直接操作 vtk 对象（`vtkColorTransferFunction`、`vtkPiecewiseFunction`）来自定义颜色/不透明度传递函数。
- **建议**：显式安装 `@kitware/vtk.js@36.4.1`（**精确锁定**，与 core 的传递版本一致，避免 npm 出现第二份 vtk、打包膨胀与类型漂移），作为直接 dependency；类型声明给预设代码用；`vite manualChunks` 已把 vtk 并入 cornerstone chunk，无需改。**不安装原版即无法写预设表**，故 FR-7 施工第一步就是加这个依赖。
- 另：3D 施工需 `detectRenderingCapabilities`/WebGL2 检测 + 低端回退（FR-14.5），core 已导出 `getRenderingCapabilities`。

### 5.3 FR-5 测量工具现状确认

- `toolSetup.ts:70-77` 五个测量工具仅进 `PLACEHOLDER_MEASUREMENT_TOOLS`：工具类已 `addTool`（保证快捷键/名称体系兼容）但**未绑定主工具、不可交互**。
- `App.tsx:511-525,649-651` 与 `shortcuts.ts` 在激活测量类时统一拦截：toast「该测量工具在 M3 提供」（`deleteAnnotationPlaceholder`/`placeholderMeasurement`）。
- 测试 `m1.shortcuts`/`m1.toolgroup`/`m7.shortcuts` 正是断言了「占位拦截」这一**现状**。→ 后续施工测量时需把占位移除、工具转正（并删除这些占位断言测试的改法，见测试改造风险）。

---

## 6. 施工建议顺序（按依赖 + 用户可见核心优先）

> 排序原则：用户可见核心（MPR=FR-6、3D=FR-7）最优先，且其前置是 Volume 地基；测量(FR-5)、截图(FR-10.1)、导出随查看体验随后；P2 项最后。

| 序 | 工程包 | 依赖 | 落地建议 |
|---|---|---|---|
| 0 | **Volume 地基（前置）** | 无 | ① `init.ts` 注册 `volumeLoader.registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader)`；② 建 volume 前对全部 imageId 预热 `ensureDcmFileMetadata`；③ 增强多帧 per-frame IMAGE_PLANE provider（用 `perFrameImagePositions`）；④ 写 `mprGate`（<2 层/无间距/无 IPP/非均匀间距判定与提示）→ 产出 FR-6/FR-7 共同地基 |
| 1 | **FR-6 MPR**（用户第一） | 0 | 按 `docs/task-m10-mpr.md`：三 VolumeViewport(Axial/Coronal/Sagittal) 共用一 volume、CrosshairTool 联动、厚度模式(Average/MIP/MINIP)、布局一键切换、退出释放 volume/视口 |
| 2 | **FR-7 3D 体绘制**（用户第二） | 0 + 装 `@kitware/vtk.js@36.4.1`（见 5.2） | 按 `docs/task-m10-3d.md`：VOLUME_3D 视口 + 5 预设（CT-Bone/Angio/Soft-Tissue/Skin/MIP）+ 复位视角 + 截图 + 能力检测/低端回退（FR-14.5） |
| 3 | **FR-5 测量**（AC-16 全流程必需） | 独立 | 移除占位拦截→转正 Length/Angle/RectELROI；**统计用原始值**（决策 §7.3-5）；双精度+2 位小数；校准兜底(5.8)；帧关联+随序列关闭清理(5.10) |
| 4 | **FR-10.1 截图 + FR-4.9/FR-3.19 关联** | 1/2（视口 ready） | 视口 missing capture → PNG；含/不含覆盖文字；全屏 |
| 5 | **FR-9 对比/融合 + FR-8 分割** | 0（FoR 已解析）+ 3（测量） | 同步联动(9.2/3.13)、棋盘格(9.3)、PET+CT 融合+色表(9.4/9.5，FoR 前置提示)、SUV(9.6，可用 calculate-suv)；阈值分割+叠加+统计(8.1-8.3)，导出排后(8.5) |
| 6 | **2D 增强** | 独立 | Cine(3.8)、旋转/翻转(3.9)、反色(3.10)、视口同步(3.13)、双序列同屏(3.14)、3×3/自定义布局(3.12)、Tag 浏览器(2.10)、搜索(2.5) |
| 7 | **PACS 补全（FR-13）** | 独立 | 分页(13.3)、分批懒加载(13.4)、网关组件+文档(13.10)、凭据存储整改(13.7，见 NFR-7)、FR-1.15 URL 加载(后于 13.11 统一) |
| 8 | **移动端补全（FR-14）** | 1/2 | 双指 WW/WL+旋转+长按防误触(14.1)、横竖屏(14.11)、3D 降质(14.5)、44px 命中(14.6)、启动画面(14.7)、性能基准(14.12) |
| 9 | **NFR 加固** | 全量之后 | Playwright E2E（AC 关键路径）、>2GB 提示(AC)、性能基准（NFR-1/2/3/4）、i18n 存量迁移+en 补全、WCAG 审计 |
| 10 | **P2 可选** | – | ZIP(1.13)、Overlay(1.16)、DICOMDIR(1.17)、缩放 Box(3.5)、Loupe(3.17)、放大/撤销/直方图/吸附(5.x)、等值面/六面盒(7.5/7.10)、会话恢复(10.4)、原文件另存(10.5)、审计日志(13.8) |

**门槛提醒**：所有施工须保持 `npm run build`（含 tsc）+ `npx vitest run` 全绿 + `npx eslint src tests` 不新增 error；改动占位拦截（如测量转正）时须**同步改造对应占位断言测试**（m1.shortcuts/m1.toolgroup/m7.shortcuts/m7.help），不许删测试而应改写为对真实行为的断言。

---

## 7. 差距小结

- **缺失（❌）87 条 / 143 条**，病例集中于用户可见核心：FR-5（17）、FR-6（10）、FR-7（12）、FR-8（6）、FR-9（5）、FR-10（5）。
- **部分（⚠️）26 条**，多为"核心可用、缺子项或未验证"，其中用户直接可见的：FR-3.8(Cine)、FR-3.12(3×3 布局)、FR-3.13(视口同步)、FR-4.5(mm 坐标)、FR-12.3(en/存量 i18n)。
- **Top 用户可见缺口（按施工顺序）**：
  1. **MPR（FR-6）整体缺失** —— 三平面/定位线联动/厚度/门槛提示，用户已确认「看不到」。
  2. **3D 体绘制（FR-7）整体缺失** —— vtk 预设/旋转/复位视角/截图。
  3. **测量（FR-5）整体缺失** —— 长度/角度/ROI 统计为占位拦截。
  4. 截图（FR-10.1）、Cine（FR-3.8）、反色/旋转（FR-3.9/3.10）、视口同步（FR-3.13）、3×3 布局（FR-3.12 扩展）。
  5. i18n 存量中文文案未迁入（en 切换不完整），PACS 凭据明文存储等 NFR 项。
- 以上「缺失/部分」与历史里程碑不符的根源：**M3/M4/M5 只有任务书、无实现 commit；M6 仅为 metadata 补字段**；M8/M7/M9 为真实实现。本报告即后续施工逐条对照基线。