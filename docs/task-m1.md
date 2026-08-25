# 任务书：M1 基础阅片 — DICOMViewer

## 背景
- 项目根：`/home/drliuhuan/DICOMViewer`，git master 分支
- M0 已完成并通过真机验收：Vite5+React18+TS5 脚手架、Cornerstone3D 5.8.2(core/loader/metadata/dicom-parser 精确锁定)、`dcm-file://` scheme 内存加载、单文件显示、Worker 解码管线
- 需求基线 `docs/需求清单.md` v1.5；本任务只做 **M1**（§8：窗宽窗位、缩放、平移、翻页、层滑块、信息开关、方向标记、适应窗口）
- 先读 `docs/tech-decisions.md` 与现有 `src/dicom/`、`src/features/viewer/` 代码再动手

## ⚠️ M0 踩坑（勿回退）
- `vite.config.ts` 的 `resolve.alias { events: 'events/' }` 是启动白屏修复，必须保留
- `worker.format:'es'` 必须保留
- 本机无法看 GUI；用 vitest + `npm run build` 验证，GUI 由主 agent 用 Playwright 验收

## 交付目标

### 1. 多文件 → 图像堆栈（翻页的前提）
- 文件选择支持多选；拖拽多文件全部解析
- 按 InstanceNumber → SliceLocation 排序形成 stack（FR-2.3 的最小实现，完整序列树仍是 M2）
- 单文件也包装为 1 帧堆栈，统一处理

### 2. Cornerstone Tools 集成（@cornerstonejs/tools@5.8.2，精确锁版本）
| 工具 | 绑定 | FR |
|---|---|---|
| WindowLevel | 左键拖动 | FR-3.2 |
| Zoom | Ctrl+滚轮(光标中心)、快捷键 +/-、工具按钮 | FR-3.5 |
| Pan | 中键拖动 或 空格+左键 | FR-3.6 |
| StackScrollMouseWheel | **滚轮=翻页(默认)**，Ctrl+滚轮让给 Zoom | FR-3.7 |
| StackScroll | 工具激活时拖动翻层 | FR-3.7 |

### 3. 窗宽窗位
- 预设下拉：脑 80/40、肺 1500/-600、骨 2500/500、软组织 400/40（CT）；MR 给一个默认预设（FR-3.3）
- WW/WL 数字输入框双向同步（拖动时实时更新输入框）（FR-3.2）
- 重置按钮恢复默认（FR-3.4）

### 4. 视图操作
- 缩放按钮组：放大/缩小/1:1/适应窗口（F）；双击视口=适应窗口（FR-3.4/3.5）
- 平移重置包含在视图重置内；Shift+R 全局重置（WW/WL+缩放+平移）（FR-3.11）
- 翻页：上一帧/下一帧按钮 + PageUp/PageDown + ←/→；显示「第 X / N 层」（FR-3.7）

### 5. 层滑块（FR-3.18 最小版）
- 视口下方 range slider，双向绑定当前帧；拖动实时刷新

### 6. 信息覆盖文字（FR-4 核心）
- `I` 键全局开/关（FR-4.1）
- 四角布局：患者(姓名/ID/性别/年龄) | 检查(日期/描述/机构) | 序列(模态/层号/层厚/矩阵) | 像素区(鼠标处坐标+灰度值+当前WW/WL+缩放比例)（FR-4.2~4.5）
- 像素值需经 Modality LUT（rescale slope/intercept）显示 HU
- 解剖方向标记（FR-4.10）：基于 ImageOrientationPatient 显示 L/R/A/P/S/I 边缘标签

### 7. 基础布局（FR-3.12 P0 最小集）
- 1×1 / 1×2 / 2×2 三档按钮 + 快捷键 1/2/4
- 各视口独立加载图像（拖文件到指定视口可选做；至少支持点击序列列表加载到激活视口）

### 8. 快捷键（FR-11 子集）
- I/W/L/A/R/O/P/Z/F/Shift+R/+/-/1/2/4/PageUp/PageDown/←→/Esc
- 文本输入框聚焦时不触发全局快捷键
- 测量工具(W/L/A/R/O)本阶段仅注册占位（激活后显示「M3 提供」提示），避免快捷键体系返工

## 不做（后续里程碑）
测量标注(M3)、MPR(M4)、3D(M5)、序列树/缩略图/文件夹递归(M2)、Cine 播放(P1 可留 M2)、i18n/PWA/PACS

## 验收标准
- [ ] `npm run build` 通过；`npx vitest run` 通过且新增 ≥6 个测试（stack 排序、WW/WL 预设映射、HU 计算 rescale、方向标记计算等纯函数）
- [ ] `tsc --noEmit` 0 error
- [ ] 多文件打开后滚轮可翻页、层数显示正确
- [ ] git 分步语义化提交（tools集成/ww-wl/视图操作/信息覆盖/布局 各自独立提交）
- [ ] `docs/m1-report.md`：改动清单、决策、已知限制

## 输出要求
完成后 stdout 简报：改动文件、build/vitest 结果摘要、遗留问题。
