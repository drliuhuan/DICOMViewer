# DICOM 查看器

浏览器端医学影像 DICOM 查看器：本地打开 DICOM 文件/文件夹，支持 MPR 三平面重建、3D 体绘制与测量标注，**数据全程不出浏览器**。

## 功能特性

- **加载**：打开单个/多个文件、打开文件夹、拖拽文件或目录递归加载；非 DICOM 文件自动识别并给出错误报告；解析进度条可取消；SOPInstanceUID 跨批次自动去重
- **序列管理**：患者→检查→序列树形导航、序列首帧缩略图、SliceLocation/IPP 实例排序、序列拖拽到任意视口、关闭序列与全量资源释放
- **阅片**：窗宽窗位预设与实时调节、缩放/平移/层滚动、1×1 / 1×2 / 2×2 多视口布局、多帧翻页与 Cine 播放、反色、旋转、四角信息覆盖、HU 像素探针、解剖方向标记、全局快捷键体系
- **测量标注**：长度、角度、矩形/椭圆 ROI（均值/标准差/极值/面积）、Cobb 角测量；测量面板快照、JSON 导入导出、DICOM SR 结构化报告输出
- **MPR 三平面重建**：轴/冠/矢三平面联动、定位线拖动、厚度模式、与 2D 视口参考线随动
- **3D 体绘制**：五种渲染预设、视角复位、裁剪、质量档位、渐进渲染、3D 截图、窗宽窗位与 2D 联动
- **PACS 联网**：DICOMweb（QIDO/WADO）服务器配置与远程序列查询、拉取
- **移动端适配**：触控手势、响应式布局、性能自适应、移动文件访问
- **其他**：中英 i18n、设置面板、PWA 离线可用、虚拟化序列列表

## 技术栈

- React 18 + TypeScript 5（strict / noUncheckedIndexedAccess / verbatimModuleSyntax）
- Vite 5 构建，产物按 cornerstone / react-vendor / vendor 分包
- @cornerstonejs/core + @cornerstonejs/tools + @cornerstonejs/dicom-image-loader + dicom-parser
- @kitware/vtk.js（3D 体绘制）
- Vitest 单元测试（600+）；ESLint 9 + Prettier

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 产物构建到 dist/
npm run preview    # 本地预览构建产物
npm run test       # Vitest 单元测试
npm run lint       # ESLint 检查
```

## 使用

启动后点击「打开文件」选择 DICOM 文件，或直接把文件/文件夹拖拽到窗口任意位置；「打开文件夹」可一次载入整个目录。解析成功后图像即在视口显示，左上角显示患者/检查信息；非 DICOM 文件会给出可见错误提示。

## 目录结构

```
src/
├─ app/            # 应用壳、布局
├─ features/       # loading(加载) viewer(视口) series(序列) measure(测量) mpr volume3d pacs cine settings shortcuts
├─ core/           # 数据层（缓存/体数据/worker 通信）
├─ dicom/          # 解析封装、imageId loader(dcm-file://)、管线初始化
└─ ui/             # 通用组件
workers/            # 自研 Web Worker
tests/              # Vitest 测试
public/             # 静态资源
docs/               # 技术决策与开发文档
```

## 约束与原则

- 零上传：所有解析与渲染均在浏览器本地完成
- 版本锁定：Cornerstone3D 生态使用精确版本，升级走独立审查
- 解码不阻塞主线程：像素解码统一走 Web Worker
