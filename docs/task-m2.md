# 任务书：M2 文件夹与序列管理 — DICOMViewer

## 背景
- 项目根：`/home/drliuhuan/DICOMViewer`，git master 分支
- M0/M1 已完成：脚手架+基础阅片（多文件堆栈、WW/WL、缩放平移翻页、多视口、序列拖拽、快捷键），89 测试全绿，已部署 Docker 容器（dist 只读挂载 → Lucky 反代）
- 需求基线 `docs/需求清单.md` v1.5；本里程碑 = M2「文件夹与序列」（FR-1.2~1.6/1.8/1.10-1.11、FR-2.1~2.4/2.7-2.9 的 P0/P1 项）

## 目标功能（按优先级实现，P0 全做、P1 做标注的项）

### A. 文件夹加载（FR-1.2/1.3）P0
1. 「打开文件夹」按钮：
   - Chromium 系：`window.showDirectoryPicker()`（File System Access API）
   - Firefox/Safari：隐藏 `<input type="file" webkitdirectory multiple>` 作为一等路径
   - 能力检测自动选择，两条路径都递归遍历全部子文件夹
2. 拖拽文件夹到窗口：`DataTransferItem.webkitGetAsEntry()` 递归读取目录树；不支持时 toast 引导用按钮入口
3. 与现有单/多文件打开共存（同一解析管线入口）

### B. 非 DICOM 识别与坏文件容错（FR-1.4/1.5）P0
1. 复用 `parseDicom.ts` 的 DICM 校验：非 DICOM 文件跳过并记录（文件名+原因）
2. 单文件解析失败不中断整批；错误列表 UI（可展开查看，含"跳过 N 个非 DICOM 文件"汇总行）
3. 大小写不敏感扩展名预筛（.dcm/.dicom 及无扩展名都尝试解析；明确排除图像/文本等常见非 DICOM 扩展以提速）

### C. 解析进度与取消（FR-1.6）P0
1. 打开 ≥20 个文件显示进度条（已解析/总数），<20 直接同步加载
2. 进度 UI 可取消（取消后保留已解析完成的文件，丢弃未开始的）
3. 分批 yield（如每 50 个文件让出主线程）避免 UI 冻结

### D. 多帧增强与元数据层级（FR-1.8/1.10）P0
1. Enhanced CT/MR（Shared/Per-frame Functional Groups）逐帧位置解析——至少正确提取 PerFrameFunctionalGroupsSequence 中的 SliceLocation/IPPSynthetic 供排序用；无法完整支持时在报告中注明限制
2. 患者→检查→序列→实例 四级元数据模型（现有 seriesList 基础上补 Patient/Study 层级）

### E. 文件去重（FR-1.11）P1
1. SOPInstanceUID 已存在则跳过（跨批次/跨文件夹）；UI 提示"跳过 N 个重复文件"

### F. 序列树形导航（FR-2.1/2.2/2.7）P0
1. 左侧面板升级为树：患者 → 检查(日期+描述) → 序列卡片（现有卡片样式并入）
2. 序列卡片信息补全：模态、描述、层数、矩阵、像素间距、层厚（数据已有，补展示）
3. 同一患者多次检查并列分组展示

### G. 实例排序完善（FR-2.3）P0
1. 排序键链：InstanceNumber → SliceLocation → IPP 投影（沿切片法向量）；现有 buildStacks.ts 基础上补 SliceLocation/IPP 两级
2. 单测覆盖：乱序输入 → 正确排序

### H. 序列缩略图（FR-2.4）P1
1. 序列卡片左侧显示首帧缩略图（离屏 canvas 渲染 → dataURL 缓存；注意内存，超过 50 个序列时只对可见卡片生成——简单方案：生成上限 100 张，超出显示占位图标）
2. 缩略图点击行为与卡片一致

### I. 数据集关闭与资源释放（FR-2.9）P0
1. 序列卡片右键/X 按钮：关闭单个序列（从面板移除 + 若已加载视口则清空该视口）
2. 工具栏「清空全部」：二次确认后清空所有数据
3. 释放：imageId 注册表（`dcm-file://` buffer Map）、cornerstone cache（`cache.purgeCache()` 或按 imageId remove）、缩略图缓存
4. 提供 `releaseSeries(uid)` / `releaseAll()` 纯函数 + 单测断言注册表/cache 清理被调用

## 明确不做（后续里程碑）
ZIP(FR-1.13)、元数据 IndexedDB 缓存(FR-1.12)、URL 加载(FR-1.15)、Tag 浏览器(FR-2.10)、搜索过滤(FR-2.5)、多选融合(FR-2.6)——属 P2 或 FR-9 范畴。

## 技术约束与已知坑（必须遵守）
1. **events polyfill 别动**：vite.config.ts 的 `resolve.alias events` 是 M0 白屏修复，禁止改动
2. **ToolGroup id 必须唯一**：`${engineId}:${viewportId}` 格式（M1 教训）
3. **空视口渲染死循环教训**：传给组件的数组引用必须稳定（模块级 EMPTY 常量），effect 依赖谨慎
4. **imageId 注册表**：`src/dicom/imageId.ts` 的 Map 是内存源，释放时必须 delete 对应 entry（当前无上限是已知债务，本次 releaseAll 一并处理）
5. File System Access API 类型：TS 需要 `@types/wicg-file-system-access` 或自行 declare，选轻量方案
6. 所有新 UI 中文文案；样式延续 styles.css 现有风格
7. 每个功能块独立 commit（语义化前缀 feat/fix/docs），不许一坨大提交

## 验证要求（本机无浏览器，单测锁行为）
1. 目录遍历：mock FileSystemDirectoryHandle / webkitGetAsEntry 递归结构，断言收集文件数与相对路径
2. 非 DICOM/坏文件：混入文本/截断文件，断言跳过且错误列表正确
3. 进度取消：模拟大批量，断言分批 yield 与取消后部分保留
4. 排序：构造乱序 InstanceNumber/SliceLocation/IPP 用例断言排序输出
5. 去重：同 UID 二次加载断言跳过
6. 树导航：患者→检查→序列层级渲染断言
7. 释放：releaseSeries/releaseAll 断言 imageId 注册表 delete、cache 清理调用
8. 缩略图：生成函数纯逻辑单测（canvas mock）
9. 既有 89 测试不许挂；`npm run build` 通过；`tsc --noEmit` 0 error；eslint 干净
10. 完成后输出简报：每个功能块的根因/实现方式、改动文件清单、测试结果、commit 列表
