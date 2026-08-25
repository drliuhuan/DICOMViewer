# M1 基础阅片 · 交付报告

> 任务书：M1 基础阅片（窗宽窗位、缩放、平移、翻页、层滑块、信息开关、方向标记、适应窗口）
> 基线：需求清单 v1.5 §8 M1 行；M0 已验收成果不回退。

## 1. 改动清单（按提交）

| 提交 | 内容 | 关键文件 |
|---|---|---|
| `feat(series)` | 多文件打开/拖拽、元数据扩展、堆栈排序（FR-2.3 最小集）、多帧展开 | `src/dicom/parseDicom.ts`、`src/features/loading/openDicomFiles.ts`、`src/features/series/buildStacks.ts`、`src/dicom/imageId.ts` |
| `feat(tools)` | @cornerstonejs/tools 5.8.2 集成：左键 WW/WL、中键平移、滚轮翻页、Ctrl+滚轮缩放；层滑块 + 层数指示 | `src/features/viewer/toolSetup.ts`、`src/features/viewer/DicomViewport.tsx` |
| `feat(ww-wl)` | 预设下拉（脑/肺/骨/软组织/MR 默认）、WW/WL 输入框双向同步、重置窗宽窗位 | `src/features/viewer/wwPresets.ts` |
| `feat(view)` | 放大/缩小/1:1/适应窗口(F)/双击适应、Shift+R 全局重置、快捷键体系 + 输入框守卫 | `src/features/shortcuts/shortcuts.ts` |
| `feat(info)` | 四角信息覆盖（患者/检查/序列/像素区）、HU 像素探针（Modality LUT）、方向标记、I 开关 | `src/dicom/pixelProbe.ts`、`src/features/viewer/orientation.ts`、`src/ui/components/InfoOverlay.tsx` |
| `feat(layout)` | 1×1 / 1×2 / 2×2 布局（快捷键 1/2/4）、激活视口、序列面板单击加载到激活视口 | `src/features/viewer/ViewerCell.tsx` |
| `docs` | 本报告 | `docs/m1-report.md` |

依赖变更：新增 `@cornerstonejs/tools@5.8.2`（精确锁版本，与 core/loader/metadata 同步，符合技术决策 D1）。

## 2. 技术要点与决策

### 2.1 工具绑定方案（tools 5.x 无 StackScrollMouseWheelTool）
5.8.2 中旧的 `StackScrollMouseWheelTool` 已并入 `StackScrollTool`（同时实现
`mouseWheelCallback` 与拖动翻层）。绑定采用"四工具常驻 Active、绑定互不冲突"：

| 工具 | 常驻绑定 | 说明 |
|---|---|---|
| WindowLevel | 左键(Primary)（默认主工具） | FR-3.2 拖动调节 |
| Pan | 中键(Auxiliary)；可被选为左键主工具 | FR-3.6 |
| Zoom | Ctrl+滚轮（Wheel+Ctrl modifier）；可被选为左键主工具 | FR-3.5 光标中心缩放（zoomToCenter:false 默认） |
| StackScroll | 滚轮(Wheel)；可被选为左键主工具=拖动翻层 | FR-3.7 默认滚轮=翻页 |

切换主工具只重新分配 Primary 按钮（`syncToolBindings`），常驻绑定合并进各工具的
bindings 数组不被覆盖。经源码核实：wheel 事件分发按
`MouseBindings.Wheel | buttons` + 实际修饰键匹配 binding 的
`mouseButton/modifierKey`，因此 Ctrl+滚轮缩放、无修饰滚轮翻页可并存。

### 2.2 多帧文件展开
`dicom-image-loader/metadata` 的 NATURALIZED 管线原生支持 `?frame=N`
查询参数（BASE_IMAGE_ID provider 剥离 frame、COMPRESSED_FRAME_DATA 按帧取像素）。
多帧文件按 NumberOfFrames 展开为 `dcm-file://<uuid>?frame=N`（1 起始）逐帧 imageId；
NATURALIZED 元数据仅按 base imageId 解析一次。

### 2.3 排序（FR-2.3 最小集）
InstanceNumber → SliceLocation → 文件名三级比较器；缺失 InstanceNumber 的实例排末尾。
完整的 IPP 空间位置排序留待 M2 序列树一并实现。

### 2.4 WW/WL 数据流
- 加载堆栈时应用默认值：文件 WindowWidth/WindowCenter (0028,1051/1050) 优先，
  其次模态预设（CT→软组织 400/40，MR→400/40），非法值回退；
- 拖动调节经元素 `VOI_MODIFIED` 事件回显到工具栏输入框与预设下拉
  （偏离预设显示「自定义」）；输入框失焦/回车提交，非法输入回退当前生效值。

### 2.5 像素探针（FR-4.5）
光标 rAF 节流 → `canvasToWorld` → `utilities.transformWorldToIndex` →
越界检查 → `cache.getImage(currentImageId)` 取原始像素 →
Modality LUT（stored×slope+intercept）→ CT 显示 HU、其余显示原值、彩色显示 RGB。

### 2.6 方向标记（FR-4.10）
基于 IOP 六元组取行/列方向余弦的主导轴（主导分量占比 ≥90%），按 DICOM 病人体坐标系
（+x=L，+y=P，+z=S）标注视口右缘/下缘并取反对称得左缘/上缘；斜行扫描不显示。
轴位/冠状/矢状标准朝向有单测锁定（AC-21 的旋转联动留待视图旋转功能落地后回归）。

### 2.7 快捷键体系
纯函数解析器（Node 可测）+ App 全局 keydown 分发：
- 文本输入框聚焦守卫（INPUT/TEXTAREA/SELECT/contentEditable）；
- Ctrl/Alt/Meta 组合一律不拦截（留给浏览器）；Shift 仅用于 Shift+R；
- 测量键 L/A/R/O 与 R（无 Shift）命中占位动作，提示「该测量工具在 M3 提供」，
  快捷键语义已定型避免返工；
- Esc = 取消当前工具回到窗宽窗位。

## 3. 测试与构建

- `npx vitest run`：**48 个测试全部通过**（M1 新增 40 个：stack 排序/分组/多帧展开 7、
  WW/WL 预设与换算 9、快捷键解析与守卫 10、HU 计算/采样/格式化 7、方向标记 6 +
  元数据扩展字段 1）；
- `tsc --noEmit`：0 error；`npm run lint`：0 问题；
- `npm run build`：通过，cornerstone chunk 独立分包保持不变；
- GUI 交互（真机滚轮翻页、拖动 WW/WL 等）由主 agent 以 Playwright 按任务书验收。

## 4. 已知限制

1. **空格+左键平移未做**：采用中键拖动方案（任务书二选一）。Space 作为修饰键在
   tools 绑定体系无一等支持，如需再评估 keydown 切换临时工具方案。
2. **压缩多帧逐帧解码**：未压缩多帧逐帧取像素已验证路径存在；压缩传输语法的
   COMPRESSED_FRAME_DATA 逐帧路径依赖 loader 实现，真实多帧压缩样本未回归。
3. **序列分组以 SeriesInstanceUID 为准**：跨文件夹去重、患者/检查层级树、缩略图、
   进度条/取消等仍属 M2。
4. **拖文件到指定视口未做**（任务书"可选做"）；现支持点击序列加载到激活视口。
5. **1:1 显示忽略 devicePixelRatio**：以 CSS 像素 ≈ 图像像素换算，高 DPI 屏上
   "1:1"为 CSS 像素口径（主流浏览器查看器同做法），后续可加 DPR 开关。
6. **Cine 播放未做**（P1，允许留 M2）；层滑块/按钮/滚轮已满足手动翻层。
7. **信息覆盖样式配置（FR-4.7）、比例尺（FR-4.8）、脱敏选项（FR-4.2）** 未做，
   属后续里程碑 P1/P2 范围。
