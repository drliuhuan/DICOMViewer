# M0 脚手架里程碑报告

> 日期：2026-08-25 ｜ 对应需求 §8 M0 与任务书 `docs/task-m0.md`

## 一、做了什么

### 工程脚手架
- Vite 5.4 + React 18.3 + TypeScript 5.9 严格模式工程：`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`（另加 noUnusedLocals/noUnusedParameters/noImplicitOverride）。
- ESLint 9 flat config（typescript-eslint recommended + react-hooks + react-refresh 规则，Prettier 兼容层）+ Prettier 3；`npm run lint` 零告警。
- 目录骨架按需求 §7.4 建立：`src/app|features/{loading,viewer,series,annotation,fusion,segmentation,export,pacs}|core|dicom|ui`、`workers/`、`tests/`、`public/`，空目录均有一行用途说明。
- 构建配置：`manualChunks` 分出 `cornerstone`（2.04MB/gzip 561KB）、`react-vendor`、`vendor` 三个 chunk；`worker.format: 'es'` 支持库内置 worker 的代码分割。

### Cornerstone3D 集成与 DICOM 管线
- 精确锁定版本：`@cornerstonejs/core@5.8.2`、`@cornerstonejs/dicom-image-loader@5.8.2`、`@cornerstonejs/metadata@5.8.2`、`dicom-parser@1.8.21`（peer 锁链一致），理由见 `docs/tech-decisions.md` D1。
- `src/dicom/imageId.ts`：实现 `dcm-file://<uuid>` 自定义 scheme——内存 ArrayBuffer 注册表 + `imageLoader.registerImageLoader('dcm-file', ...)`；加载时经 `addDicomPart10Instance` 预置 NATURALIZED 元数据后委托官方 `loadImageFromNaturalizedMetadata` 管线解码。纯函数部分不依赖浏览器 API，可单测。
- Web Worker：`initDicomImageLoader({maxWebWorkers})` 建立 decode worker 池；核实库内全部传输语法（含未压缩）解码均派发至该 worker，主线程零阻塞。
- `src/dicom/parseDicom.ts`：DICM 魔数校验 + dicom-parser 解析封装 + 容错元数据摘要提取，统一抛 `NotDicomError`。

### 功能（FR-1.1 最小版）
- 文件选择按钮 + 全窗口拖拽两个入口；拖拽有高亮反馈。
- 解析成功 → StackViewport 显示图像；左上角覆盖文字显示 PatientName / Modality / Rows×Cols（多帧附加帧数）。
- 非 DICOM / 截断文件 / 无像素数据的 DICOM（如 SR）→ 红色错误横幅可见提示，应用不崩溃。

### 测试
- Vitest 冒烟测试 6 例全过：手工编码最小合法 Part-10 文件（显式 VR 小端 CT）验证魔数识别、元数据提取、自定义参数解析、非 DICOM 报错、截断容错、imageId 注册表 roundtrip。

## 二、验证结果

| 验收项 | 结果 |
|---|---|
| `npm install` 无 error | ✅ 281 packages（仅上游 deprecation warning） |
| `npm run build` | ✅ tsc --noEmit 通过；产物含 `cornerstone-CXtDp6Yl.js`（2,043.74 kB）分包及 `decodeImageFrameWorker` chunk、4 个 wasm 编解码资产 |
| `npx vitest run` | ✅ 6 passed (6) |
| `src/dicom/imageId.ts` 实现 dcm-file:// 注册 | ✅ |
| 双入口 + 非 DICOM 可见报错 | ✅（代码审查级验证，GUI 待用户真机确认） |
| git log ≥3 条语义化提交 | ✅ chore(脚手架) → feat(M0 核心) → docs |
| `npm run preview` 冒烟 | ✅ index.html 与全部 chunk/CSS 均 HTTP 200 |

## 三、关键决策摘要

1. **版本锁定**：四包精确锁版并记录 peer 锁链依据（D1）；vtk.js 暂为传递依赖，M5 显式声明。
2. **自定义 scheme 实现路径**：不复刻 legacy wadouri 管线，预置 NATURALIZED 元数据后复用官方自然化管线（D2），免费获得全部传输语法/LUT/反相能力。
3. **worker format=es**：库内置 worker 引用 codec 包导致 iife 构建失败，改用模块 Worker（目标浏览器均支持）（D3）。
4. **不提前引入 zustand**（D5）：单一加载状态用 useState 足够。

## 四、已知限制

1. **仅单文件**：多选文件只取第一个；文件夹递归/进度条/序列树按计划属 M2。
2. **GUI 未真机验证**：本环境无浏览器，视口显示链路基于源码级集成与构建产物资源检查；请以「打开一个真实 DICOM 显示图像」做最终验收（验收标准原文要求）。若压缩传输语法样本显示异常，优先检查 wasm 资产的部署路径。
3. **内存注册表无上限/无释放**：`dcm-file://` buffer 常驻内存，无 LRU 与显式释放接口（NFR-4 内存策略属后续里程碑；当前重复打开同一文件会新增注册表项，旧项待 M2 统一清理）。
4. **中文 PN 依赖默认字符集**：未解析 (0008,0005) Specific Character Set，非 UTF-8 编码的中文患者名可能乱码（FR-1.10 元数据层级完整解析在 M2 补齐）。
5. **信息覆盖为最小集**：仅 3 行验证性文字，FR-4 全量面板（四级元数据/脱敏/开关/样式）在 M1/M4+ 实现。
6. 上游 codec 包对 node 内置模块（fs/path）的引用被 Vite 外部化告警，属库自身运行时环境探测代码，浏览器路径不受影响。

## 五、下一步建议（M1）

1. 接入 `@cornerstonejs/tools`：WW/WL（左键拖动 + CT 预设）、缩放、平移、翻页、适应窗口、重置（FR-3.2~3.11）。
2. 信息开关快捷键 `I` 与方向标记（FR-4.1/4.10）。
3. 为 imageId 注册表补释放接口（`cache` + 注册表联动），为 M2 内存策略打基础。
4. 用真实 CT 数据集回归压缩传输语法（JPEG Baseline/J2000）解码路径，确认 worker+wasm 在真机的表现。
