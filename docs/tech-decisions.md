# 技术决策记录

> 记录关键技术选型及理由。新决策追加在文末，注明日期与依据。

## D1 Cornerstone3D 生态版本锁定（2026-08）

**决策**：package.json 锁定精确版本（不带 `^`）：

| 包 | 版本 | 角色 |
|---|---|---|
| `@cornerstonejs/core` | **5.8.2** | 渲染引擎、视口、imageLoader/metaData 注册 |
| `@cornerstonejs/dicom-image-loader` | **5.8.2** | DICOM 加载与解码（Web Worker） |
| `@cornerstonejs/metadata` | **5.8.2** | NATURALIZED 元数据存储（core/loader 的 peer dep） |
| `dicom-parser` | **1.8.21** | Part-10 元数据解析（loader 的 peer dep，纯读） |

**理由**：

1. 需求 §7.3-7 明确要求：Cornerstone3D 与 vtk.js 生态迭代快，锁定精确版本，升级走 MR。
2. 四个包存在严格的 peer dependency 锁链（`dicom-image-loader@5.8.2` peer 要求 `core@5.8.2`、`metadata@5.8.2`、`dicom-parser@1.8.21`），必须同步升级；选 5.8.2 为发布时最新稳定线，且 core/loader/metadata 三包同版本号发布，兼容性由上游 CI 保证。
3. dcm-image-loader v3+ 重写后的"自然化元数据"管线（`addDicomPart10Instance` → `loadImageFromNaturalizedMetadata` → `createImage`）是官方主路径，OHIF 同源使用，API 相对稳定。
4. vtk.js 未直接依赖：作为 `@cornerstonejs/core` 的传递依赖（`@kitware/vtk.js@36.4.1`）被锁定引入；M5 直接使用 vtk.js 时再显式声明并对齐该版本。

**影响**：升级需同时改四个精确版本并跑全量测试；收益是避免生态快速迭代导致的隐性破坏（风险表 §10 "Cornerstone3D 版本 API 变动"）。

## D2 imageId 自定义 scheme `dcm-file://` 的实现路径（2026-08）

**决策**：`src/dicom/imageId.ts` 内实现 scheme 注册表（内存 Map：key → Part-10 ArrayBuffer），通过 `imageLoader.registerImageLoader('dcm-file', ...)` 注册加载器；加载时先用 `@cornerstonejs/metadata` 的 `addDicomPart10Instance(imageId, buffer)` 把缓冲区挂入 NATURALIZED 元数据存储，再委托 `loadImageFromNaturalizedMetadata` 走 dicom-image-loader 标准解码管线。

**理由**：

1. 需求 §7.3-1 要求自定义 scheme、从 ArrayBuffer 直接解码、避免磁盘 IO 中间层——注册表方案完全内存化，满足。
2. 不复刻 wadouri 老管线（`dataSetCacheManager` + legacy metaDataProvider）：v3+ 默认已切换到自然化元数据 + `registerDefaultProviders()`，预置元数据后复用官方管线可免费获得全部传输语法解码、MONOCHROME1 反相、LUT、调色板等能力。
3. `imageId.ts` 刻意不顶层 import 重依赖（动态 import cornerstone），纯函数部分（生成/取回 imageId）可在 Node 下单测。

## D3 解码 Worker 配置（2026-08）

**决策**：调用 `initDicomImageLoader({ maxWebWorkers, strict: false })`，其内部经 `getWebWorkerManager().registerWorker('dicomImageLoader', ...)` 建立 worker 池（comlink）；Vite 侧设置 `worker: { format: 'es' }`。

**理由**：

1. 实测 `decodeImageFrame` 对全部传输语法（含未压缩 Implicit/Explicit VR LE）都走 `webWorkerManager.executeTask('dicomImageLoader', 'decodeTask', ...)`，即解码天然不阻塞主线程（需求 FR-3.16 / §7.3-2）。
2. `worker.format: 'es'` 是必需项：库内置 worker 引用了 codec 包，iife 格式不支持代码分割会导致构建失败；模块 worker 在目标浏览器（Chrome/Edge/Firefox/Safari 最新两版，NFR-5）均支持。
3. wasm 编解码器（CharLS/OpenJPEG/OpenJPH/libjpeg-turbo）随构建产出为独立 `.wasm` 资产，无需手工拷贝。

## D4 构建分包策略（2026-08）

**决策**：`manualChunks` 将 `@cornerstonejs/*`、`@kitware/vtk.js`、`dicom-parser` 归入 `cornerstone` chunk，react/react-dom/scheduler 归入 `react-vendor`，其余 node_modules 归入 `vendor`。

**理由**：cornerstone chunk 约 2MB（gzip 后 ~560KB），独立分包便于浏览器长期缓存，且后续里程碑（M1 tools、M5 vtk.js 显式依赖）增量升级时不污染业务 chunk；满足验收标准"产物含 cornerstone chunk 分包"。

## D5 M0 不引入 zustand（2026-08)

**决策**：M0 仅用 React useState 管理加载状态，zustand 推迟到 M2（序列树/多序列状态真正复杂化时）引入。

**理由**：避免提前抽象；M0 只有单一"当前打开文件"状态，引入状态库属于提前实现（任务书明确不做超前开发）。
