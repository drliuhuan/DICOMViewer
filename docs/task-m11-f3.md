# 任务书 M11-F3：鼠标按键绑定矩阵调整（3D/MIP 与 2D/MPR 分离）

## 项目
/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版+vtk.js 36.4.1）

## 用户需求（明确指令）
**3D/MIP 视图**：左键=平移，中键按住=窗宽窗位，右键=旋转
**二维视图/MPR**：左键=平移，中键按住=窗宽窗位，右键=滚动序列（向上/向下翻层）

## 现状（监督方已核对源码）
| 视图 | 左键 Primary | 中键 Auxiliary | 右键 Secondary | 滚轮 Wheel |
|---|---|---|---|---|
| 2D (src/features/viewer/toolSetup.ts) | WindowLevel（且是主工具切换目标） | Pan | — | stackScroll；Ctrl+Wheel=Zoom |
| MPR (src/features/mpr/mprToolGroup.ts) | WindowLevel（主工具切换目标之一） | Pan | Crosshairs（定位线拖动，MPR 联动核心 FR-6.2/6.3） | stackScroll；Ctrl+Wheel=Zoom |
| 3D (src/features/volume3d/toolGroup.ts) | TrackballRotate | Pan | — | Zoom |

## 目标绑定矩阵
**2D 与 MPR**：
- 左键 Primary：Pan（**作为默认主工具/基础交互**）；测量类工具激活时左键仍归测量工具（既有主工具切换机制保留）
- 中键 Auxiliary：WindowLevel（常驻，任何状态下按住中键=窗宽窗位）
- 右键 Secondary：StackScroll（按住右键拖动=滚动序列，向上=上/前帧、向下=下/后帧，方向参照 cornerstone StackScrollTool 拖动语义）
- 滚轮保持：stackScroll（2D/MPR 滚轮翻层）、Ctrl+滚轮=Zoom（不变）

**3D/MIP**：
- 左键 Primary：Pan
- 中键 Auxiliary：WindowLevel（3D 当前未注册该工具，需 addTool + 绑定；VOLUME_3D 视口支持 WindowLevel 鼠标交互）
- 右键 Secondary：TrackballRotate（3D 旋转）
- 滚轮保持：Zoom（不变）

## 已知冲突与决策点（必须解决，简报中说明方案）
1. **MPR Crosshairs 占用 Secondary** 与「右键=StackScroll」冲突。Crosshairs 是 MPR 定位线联动核心，不能丢。候选方案（二选一，选更符合现有架构的）：
   a) Crosshairs 移入 MPR「可切换主工具」机制（左键激活时拖动定位线，默认主工具为 Pan，工具栏切换）
   b) Crosshairs 改绑其他修饰组合（如 Ctrl+Primary / Shift+Primary），保持默认右键归 StackScroll
   若选 a，注意 mprToolGroup 已有主工具切换机制（约 130-180 行），把 Crosshairs 纳入；默认主工具 = Pan。
2. **2D 主工具语义**：原默认主工具是 WindowLevel（左键）。改为默认 Pan 后：WindowLevel 不再占用 Primary（只留 Auxiliary 常驻）；「切换主工具」逻辑（PERSISTENT_BINDINGS / setToolPassive 剥离 Primary，见 toolSetup.ts 180-220 行）调整为默认主工具=Pan，测量工具激活时占 Primary、切回后左键回归 Pan。**注意 M11 已知坑：setToolActive 合并语义，必须先 setToolPassive 剥离再重建，否则旧绑定残留。**
3. **3D WindowLevel**：需确认 VOLUME_3D 视口 + WindowLevelTool 鼠标交互可用（cornerstone 5.8.2 支持 volume 视口窗宽窗位交互）；若绑定后中键拖动无效，检查 ToolGroup 与视口关联（addViewport）与 addTool 顺序（先 addTool 再 setToolActive 的坑）。

## 表面同步（必须一起改，zh/en 两份）
- 工具栏按钮 title/aria-label 文案：窗宽窗位、平移、层滚动、「校准」等涉及按键描述的提示全部改为新矩阵（如「窗宽窗位（中键拖动，快捷键 W）」「平移（左键拖动，快捷键 P）」「层滚动（右键拖动翻层；滚轮默认翻页）」；3D 旋转说明「右键拖动旋转」）。
- 帮助/快捷键速查表（src/ui/i18n/zh.ts、en.ts 及 HelpOverlay 相关）：键位表同步新矩阵。
- 移动端触控绑定（numTouchPoints）**保持不变**（用户未要求改触屏）。

## 测试要求
- 更新/新增绑定断言：2D toolgroup、MPR toolgroup、3D toolgroup 的 bindings 断言改为新矩阵（m1.toolgroup、m10.mprViewport/mprToolGroup、m10.vol3d*、m11.vol3dEntrance 等涉及用例）；列出改动了哪些既有断言（与 M11-F1 同风格：只改语义冲突的，不顺手改）。
- 新增纯逻辑/调用链测试：默认主工具=Pan 的切换行为（切测量再切回，左键回归 Pan）、WindowLevel 常驻 Auxiliary 在任何主工具下的可用性、MPR Crosshairs 新方案下的联动入口断言（视方案而定）、3D WindowLevel 绑定存在。
- 不改 touch 绑定相关既有测试。

## 约束
- 内存紧张：只跑 `npx tsc --noEmit` + 涉及测试文件（分组串行），禁止全量 vitest/build（监督方复跑）。
- 独立 commit（`<type>(<scope>): 描述`）+ `git push origin master`（失败报告即可）。
- 不写 Home 外目录；范围克制，只做本任务书条目；不改工具行为算法本身（只改绑定映射与文案）。
- stdout 简报：绑定矩阵实现说明（含 Crosshairs 方案选择）、更新/新增测试清单、改动文件清单、验证命令与结果；不要自行 Playwright（监督方 GUI 复测）。