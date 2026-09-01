# DICOM 查看器 / DICOMViewer

浏览器端医学影像 DICOM 查看器：本地打开 DICOM 文件/文件夹，支持 MPR 三平面重建、3D 体绘制与测量标注，**数据全程不出浏览器**。
A browser-based medical imaging DICOM viewer: open DICOM files/folders locally, with MPR multi-planar reconstruction, 3D volume rendering and measurements — **your data never leaves the browser**.

## 功能特性 / Features

- **加载**：打开单个/多个文件、打开文件夹、拖拽文件或目录递归加载；非 DICOM 文件自动识别并给出错误报告；解析进度条可取消；SOPInstanceUID 跨批次自动去重
  **Loading**: open single/multiple files, open folders, drag-and-drop recursive directory loading; automatic non-DICOM detection with error reports; cancellable parsing progress; automatic SOPInstanceUID deduplication across batches
- **序列管理**：患者→检查→序列树形导航、序列首帧缩略图、SliceLocation/IPP 实例排序、序列拖拽到任意视口、关闭序列与全量资源释放
  **Series management**: patient→study→series tree navigation, first-frame thumbnails, SliceLocation/IPP instance sorting, drag series onto any viewport, close series with full resource release
- **阅片**：窗宽窗位预设与实时调节、缩放/平移/层滚动、1×1 / 1×2 / 2×2 多视口布局、多帧翻页与 Cine 播放、反色、旋转、四角信息覆盖、HU 像素探针、解剖方向标记、全局快捷键体系
  **Viewing**: window/level presets with live adjustment, zoom/pan/slice scrolling, 1×1 / 1×2 / 2×2 multi-viewport layouts, multi-frame paging and Cine playback, invert, rotate, corner overlay info, HU pixel probe, anatomical orientation markers, global keyboard shortcuts
- **测量标注**：长度、角度、矩形/椭圆 ROI（均值/标准差/极值/面积）、Cobb 角测量；测量面板快照、JSON 导入导出、DICOM SR 结构化报告输出
  **Measurements**: length, angle, rectangle/ellipse ROI (mean/std-dev/min-max/area), Cobb angle; measurement panel snapshots, JSON import/export, DICOM SR structured report output
- **MPR 三平面重建**：轴/冠/矢三平面联动、定位线拖动、厚度模式、与 2D 视口参考线随动
  **MPR reconstruction**: axial/coronal/sagittal planes with linkage, draggable reference lines, slab thickness mode, reference-line synchronization with 2D viewports
- **3D 体绘制**：五种渲染预设、视角复位、裁剪、质量档位、渐进渲染、3D 截图、窗宽窗位与 2D 联动
  **3D volume rendering**: five render presets, view reset, cropping, quality levels, progressive rendering, 3D screenshots, window/level synced with 2D
- **PACS 联网**：DICOMweb（QIDO/WADO）服务器配置与远程序列查询、拉取
  **PACS connectivity**: DICOMweb (QIDO/WADO) server configuration with remote series query and retrieval
- **移动端适配**：触控手势、响应式布局、性能自适应、移动文件访问
  **Mobile adaptation**: touch gestures, responsive layout, performance adaptation, mobile file access
- **其他**：中英 i18n、设置面板、PWA 离线可用、虚拟化序列列表
  **Misc**: Chinese/English i18n, settings panel, PWA offline support, virtualized series list

## 技术栈 / Tech Stack

- React 18 + TypeScript 5（strict / noUncheckedIndexedAccess / verbatimModuleSyntax）
- Vite 5 构建，产物按 cornerstone / react-vendor / vendor 分包 / Vite 5 build, chunked by cornerstone / react-vendor / vendor
- @cornerstonejs/core + @cornerstonejs/tools + @cornerstonejs/dicom-image-loader + dicom-parser
- @kitware/vtk.js（3D 体绘制 / 3D volume rendering）
- Vitest 单元测试（600+）/ Vitest unit tests (600+); ESLint 9 + Prettier

## 快速开始 / Quick Start

```bash
npm install        # 安装依赖 / Install dependencies
npm run dev        # 开发服务器（默认 http://localhost:5173）/ Dev server (default http://localhost:5173)
npm run build      # 类型检查 + 产物构建到 dist/ / Type-check + build to dist/
npm run preview    # 本地预览构建产物 / Preview the production build locally
npm run test       # Vitest 单元测试 / Vitest unit tests
npm run lint       # ESLint 检查 / ESLint
```

## 使用 / Usage

启动后点击「打开文件」选择 DICOM 文件，或直接把文件/文件夹拖拽到窗口任意位置；「打开文件夹」可一次载入整个目录。解析成功后图像即在视口显示，左上角显示患者/检查信息；非 DICOM 文件会给出可见错误提示。
After launch, click "Open File" to select a DICOM file, or drag files/folders anywhere onto the window; "Open Folder" loads an entire directory at once. Parsed images appear in the viewport immediately, with patient/study info at the top-left; non-DICOM files produce a visible error message.

## 目录结构 / Project Structure

```
src/
├─ app/            # 应用壳、布局 / App shell & layout
├─ features/       # loading(加载) viewer(视口) series(序列) measure(测量) mpr volume3d pacs cine settings shortcuts
├─ core/           # 数据层（缓存/体数据/worker 通信）/ Data layer (cache/volume/worker comms)
├─ dicom/          # 解析封装、imageId loader(dcm-file://)、管线初始化 / Parsing, imageId loader, pipeline init
└─ ui/             # 通用组件 / Shared components
workers/            # 自研 Web Worker / Custom Web Workers
tests/              # Vitest 测试 / Vitest tests
public/             # 静态资源 / Static assets
docs/               # 技术决策与开发文档 / Technical decisions & dev docs
```

## 约束与原则 / Principles

- 零上传：所有解析与渲染均在浏览器本地完成 / Zero upload: all parsing and rendering happens locally in the browser
- 版本锁定：Cornerstone3D 生态使用精确版本，升级走独立审查 / Version pinning: exact versions for the Cornerstone3D ecosystem, upgrades go through separate review
- 解码不阻塞主线程：像素解码统一走 Web Worker / Non-blocking decoding: pixel decoding runs in Web Workers

## 捐赠与赞助 / Donations

**Buy me some tokens. ⚡**

DICOM 查看器完全免费开源。如果你觉得它有用，欢迎扫码支持作者继续开发——每一份心意都会让这个项目变得更好。
DICOMViewer is completely free and open source. If you find it useful, feel free to scan and support the author — every contribution helps make this project better.

| 微信支付 / WeChat Pay | 支付宝 / Alipay |
|---|---|
| ![WeChat Pay](assets/donate/wechat.png) | ![Alipay](assets/donate/alipay.jpg) |

> **重要声明 / Important Notice**：捐赠是对开发的支持，**不代表商业授权**。任何商业使用仍须通过 [GitHub Issues](https://github.com/drliuhuan/DICOMViewer/issues) 联系作者签署书面授权协议。
> Donations are a gesture of support and **do NOT constitute a commercial license**. Any commercial use still requires a written license agreement from the author via [GitHub Issues](https://github.com/drliuhuan/DICOMViewer/issues).
