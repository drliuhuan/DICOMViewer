# 任务书：M0 脚手架 — DICOM 查看器项目初始化

## 项目背景
- 项目根目录：`/home/drliuhuan/DICOMViewer`（已 git init，master 分支，空仓库）
- 完整需求文档：`docs/需求清单.md`（v1.5 基线，**先通读 §7 技术选型与目录结构再动手**）
- 产品形态：纯前端 SPA，浏览器本地打开 DICOM 文件/文件夹，数据不出浏览器
- 本任务只做 **M0 里程碑**，后续里程碑由后续任务书驱动，不要提前实现

## 环境约束（硬性）
- 本机为 Linux x64，Node v22.23.1 / npm 10.9.8 可用；**可以联网 npm install**
- 不要安装全局依赖；一切走 package.json local deps
- 浏览器端运行环境无法在本机验证 GUI，**不要启动长驻 dev server 阻塞退出**；验证用 `npm run build` + `npm run preview`（限时起停）或单元测试代替

## M0 交付目标（对应需求文档 §8 M0）
1. **Vite 5 + React 18 + TypeScript 5 严格模式工程**
   - tsconfig 开 strict、noUncheckedIndexedAccess、verbatimModuleSyntax
   - ESLint + Prettier 基础配置
2. **Cornerstone3D 集成**
   - 安装 @cornerstonejs/core、@cornerstonejs/dicom-image-loader、dicom-parser
   - **版本锁定精确版本**（需求 §7.3-7），记录所选版本及理由到 docs/tech-decisions.md
3. **imageId 自定义 scheme `dcm-file://`**（§7.3-1）
   - loader 从 ArrayBuffer 直接解码（本阶段不需要 File System Access，内存传入即可）
   - dicom-image-loader 的 web worker 配置跑通（解码不阻塞主线程）
4. **打开单个 DICOM 文件并显示**（FR-1.1 最小版）
   - 文件选择按钮 + 拖拽文件到窗口两种入口
   - 解析成功 → Cornerstone viewport 显示图像
   - 解析失败/非 DICOM → 错误提示（暂不用完整错误报告列表，那是 M2）
5. **最小信息覆盖文字**（仅为验证管线，不是 FR-4 全量）：左上角显示 PatientName / Modality / Rows×Cols
6. **目录骨架按 §7.4 建立**：src/app、src/features/*、src/core、src/dicom、src/ui、workers、tests、public —— 空目录放 .gitkeep 或占位 README 一行说明用途
7. **Vitest 跑通一个冒烟测试**（如 dicom 解析封装对合成小 DICOM buffer 返回预期 metadata）
8. **README.md**：项目一句话简介、技术栈、如何 `npm i && npm run dev && npm run build`
9. git 提交分步做好（脚手架一次、功能一次、文档一次即可）

## 明确不做（M0 范围外）
- 文件夹递归加载、进度条、序列树（M2）
- WW/WL 工具、测量、MPR、3D（M1/M3/M4/M5）
- PACS、i18n、PWA、移动端（M7-M9）
- gateway/ 组件

## 验收标准
- [ ] `npm install` 一次性通过无 error
- [ ] `npm run build` 通过且产物含 cornerstone chunk 分包（manualChunks 或等效）
- [ ] `npx vitest run` 通过
- [ ] `src/dicom/imageId.ts` 存在且实现 dcm-file:// 注册
- [ ] App 具备文件选择+拖拽两个入口，非 DICOM 文件给出可见错误提示
- [ ] git log 有 ≥3 条语义化提交
- [ ] 写一份 `docs/m0-report.md`：做了什么、关键决策、已知限制、下一步建议

## 输出要求
完成后在 stdout 输出简报：改动文件清单、build/vitest 结果原文摘要、遗留问题。
