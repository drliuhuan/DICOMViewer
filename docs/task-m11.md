# 任务书 M11：MPR/3D 完整序列加载与序列选择、3D 入口修复、Cobb 角测量、按钮图标化

## 项目
/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 四包锁版+dicom-parser 1.8.21+vtk.js 36.4.1）
本机内存紧张（约 15G）：**禁止跑全量 vitest/build**，只跑 `npx tsc --noEmit` + 你改动涉及的测试文件（vitest 单文件/相关描述块）。全量核验由 Hermes 监督方复跑。

## 通用约束
- 只做本任务书条目，不做顺手重构；UI 文案简体中文；修改 i18n 时 zh/en 同步。
- 每完成一个任务独立 git commit（一行中文 message，格式 `<type>(<scope>): 描述`），全部完成后一次性 `git push origin master`（若 push 失败不要反复试，在简报说明，由监督方补推）。
- 不要写 /tmp 等 Home 外目录（权限拦截会中断进程）；临时调试文件放 tests/ 下。
- 代码注释遵守既有风格；不删/不改既有测试（只增）。
- 完成后 stdout 简报：按任务列出「完成清单 / 未做（TODO）」+ 改动文件清单 + 你实际跑过的验证命令与结果。

---

## 任务 1（P0，用户强调必做）：MPR/3D 必须完整加载序列 + 进入时让用户选择序列

### 背景与根因线索（监督方已初步定位，你需深入确认）
- `src/features/series/buildStacks.ts`：`SeriesStack.items` 由 `buildSeriesStacks(opened: OpenedDicomFile[])` 从**已打开的文件**构建——仓库当前只加载了用户在 2D 查看界面看到/已打开的那部分文件。
- `src/features/mpr/mprVolume.ts`：`collectVolumeImageIds(stack)` 只返回 `stack.items.map(i => i.imageId)`，`buildMprVolume(volumeId, stack, deps)` 用这些 imageId 建 volume。**MPR 三平面与 3D 体绘制（src/features/volume3d/Volume3dViewport.tsx 调用同一 buildMprVolume）只用到了可见层面 → 未打开/未加载的层面缺失 → MPR 看到的是黑的、3D 结构不完整**（用户实测报告）。
- 多帧文件逐帧展开逻辑在 `src/dicom/imageId.ts`（`?frame=N` 惯例、splitNaturalizedPixelDataIntoFrames）。

### 需求
1. **进入 MPR 或 3D 时弹出序列选择**：当存在多个候选序列（打开的文件来自 ≥2 个序列；含 PACS 远程序列）或当前序列未完整加载时，点「MPR」/「3D」按钮先弹序列选择器（列出序列号/描述/层数/模态），用户选定后才进入对应布局。单序列且已完整加载时可跳过选择直接进入。
2. **主动把完整序列调完**：用户选定序列后，必须从该序列的**完整来源**把全部实例（全部文件的全部帧）加载/枚举进来，再构建 volume——不允许只用当前已加载的可见层面。数据来源分两类，你需分别调查实现：
   - 本地文件夹/文件来源：`opened` 文件来自何处（FileSystemDirectoryHandle / 打开文件列表），如何枚举同序列未打开的文件并补齐；
   - PACS 远程来源：`src/features/pacs/`（dicomweb.ts / remoteInstances.ts），如何按 SeriesUID 拉取完整实例列表与数据。
3. volume 构建基于完整 imageId 集合后，**MPR 三平面与 3D 不再黑、层面齐全**（这是用户验收的硬标准：完整序列必须全部进入重建，缺失任何可见结构即失败）。
4. UI 反馈：加载完整序列期间显示进度/加载态，失败有明确错误提示（中文）。

### 验收
- 单元测试覆盖：序列选择器的候选序列判定逻辑（多序列/单序列/未完整）、完整序列 imageId 收集（含多帧展开）不再依赖可见窗口、缺数据时的错误路径。
- 你自测：能造出「只打开部分文件 → 点 MPR → 选择序列 → volume 用完整 imageIds 构建」的调用链证据（测试断言优先）。

---

## 任务 2（P0）：3D 入口点击后无任何反应，修复

### 现象
点击「3D」按钮后没有任何反应（不进入 3D、无报错提示、UI 无变化）。

### 要求
1. 调查根因（入口事件未绑定 / 布局状态机未切换 / gate 判定静默失败 / volume 构建静默抛错 / WebGL 检查失败被吞），**给出证据链**（grep 入口代码、追踪 onClick → layout 切换 → gate → Volume3dViewport 挂载调用链）。
2. 修复后点击 3D 能正常进入 3D 布局并渲染（WebGL2 不可用的环境给出明确提示而非无反应）。与任务 1 共用完整序列加载路径。
3. 单元测试覆盖入口调用链（gate 判定、布局状态切换、构建失败错误提示）。

---

## 任务 3（P1）：测量新增 Cobb 角工具（两条线段之间夹角）

### 需求
- 新增测量工具「Cobb 角」（cornerstone 无内置，需自定义 annotation tool）：本质是**两条线段之间的夹角**。交互：依次放置 4 个点（第 1、2 点构成线段 A，第 3、4 点构成线段 B），或等效的两次放置线段交互；标注显示两条线段长度 + 夹角 θ（度，取两线夹角语义：θ∈[0,180)，医学 Cobb 角按两线段延长线交角近似，钝角显示其补角值）。
- 端点可拖动调整；完成后可选中/删除（与既有测量工具一致）。
- 纳入既有测量体系：`src/features/measure/`（annotationModel、annotationEvents、annotationRuntime、roiStats、srExport、AnnotationsPanel、CalibrationPanel 相关)，支持标注面板列表、JSON 导出导入、DICOM SR 导出（若现有角度工具已支持 SR，Cobb 角照抄其通道）。
- 工具栏按钮 + 快捷键注册（参照既有角度工具在 toolSetup.ts / shortcuts.ts 的注册方式）。

### 验收
- 纯逻辑单测：两线段夹角计算（含平行/垂直/补角边界）；与既有 AngleTool 行为对齐的交互状态机测试（mock cornerstone tools）。
- 不破坏既有长度/角度/ROI 测量测试。

---

## 任务 4（P1）：所有按钮改为图标模式

### 需求
- 工具栏与各面板（SeriesPanel/PacsPanel/SettingsPanel/AnnotationsPanel/CalibrationPanel/InfoOverlay/HelpOverlay 等）的所有按钮从文字按钮改为**图标按钮**：图标（SVG）+ tooltip（title/aria-label），窄屏/小屏时只显示图标。
- 图标方案你自己评估：优先**内联 SVG 组件**（不引大依赖、体积可控）；若项目已有图标库则复用。中英文 tooltip 走既有 i18n（zh/en 同步）。
- 键盘可访问性保持：按钮 focus 样式、aria-label、快捷键不变。

### 验收
- 组件测试（如已有按钮渲染测试则更新断言图标/tooltip 存在）；tsc 通过。
- 汇报里列明每个按钮改成了什么图标。

---

## 已知坑（必须遵守）
- Cornerstone3D：ToolGroup 必须 addTool 后 setToolActive；init 异步完成后才能 enableElement；vite events alias 别动。
- 多视口 ToolGroup id 唯一；切工具用 setToolPassive 剥离 Primary 绑定。
- PACS 相关改动先读既有 remoteInstances/dicomweb 的模式，不要另起一套。
- 内存约束：任何验证命令不得全量并行跑；大测试文件单独跑。