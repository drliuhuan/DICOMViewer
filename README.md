# DICOM 查看器

浏览器端医学影像 DICOM 查看器：本地打开 DICOM 文件/文件夹（含 MPR、3D 重建与测量），**数据全程不出浏览器**。

> 完整需求见 `docs/需求清单.md`（v1.5 基线）。当前进度：**M0 脚手架完成**（打开单个 DICOM 文件并显示），里程碑规划见需求 §8。

## 技术栈

- React 18 + TypeScript 5（strict / noUncheckedIndexedAccess / verbatimModuleSyntax）
- Vite 5 构建，产物按 cornerstone / react-vendor / vendor 分包
- @cornerstonejs/core + @cornerstonejs/dicom-image-loader + dicom-parser（精确版本锁定，理由见 `docs/tech-decisions.md`）
- Vitest 单元测试；ESLint 9 + Prettier

## 快速开始

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 产物构建到 dist/
npm run preview    # 本地预览构建产物
npm run test       # Vitest 单元测试
npm run lint       # ESLint 检查
```

## 使用（M0）

启动后：点击「打开文件」选择一个 DICOM 文件，或直接把文件拖拽到窗口任意位置。
解析成功即在视口显示图像，左上角显示 PatientName / Modality / Rows×Cols；
非 DICOM 文件会给出可见错误提示。

## 目录结构（§7.4）

```
src/
├─ app/            # 应用壳、布局
├─ features/       # loading(加载) viewer(视口) series annotation fusion segmentation export pacs
├─ core/           # 数据层（缓存/体数据/worker 通信）
├─ dicom/          # 解析封装、imageId loader(dcm-file://)、管线初始化
└─ ui/             # 通用组件
workers/            # 自研 Web Worker（M0 使用 dicom-image-loader 内置解码 worker）
tests/              # Vitest 测试
public/             # 静态资源
docs/               # 需求清单、技术决策、里程碑报告
```

## 约束与原则

- 零上传：所有解析与渲染均在浏览器本地完成（NFR-7）；
- 版本锁定：Cornerstone3D 生态使用精确版本，升级走 MR（§7.3-7）；
- 解码不阻塞主线程：像素解码统一走 Web Worker（§7.3-2）。
