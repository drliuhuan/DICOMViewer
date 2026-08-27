# 任务书 M11-F2：3D 视口黑屏修复（容器高度塌陷，canvas 0 高）

## 项目
/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版+vtk.js 36.4.1）

## 用户反馈
点击 3D 后进入 3D 布局（工具栏/面板正常、InfoOverlay 显示、status 到 ready），但**主显示区全黑、没有任何 3D 渲染**。真机与 headless 均复现。

## 监督方证据链（Playwright 实测，已根因定位，勿再发散）
1. DOM 尺寸探测（1400x900 视口，8 实例 CT 序列过 gate 后点 3D）：
   - `.mpr-grid-wrap`：w=1138 **h=677**（正常）
   - `.viewport-cell`：w=1138 **h=2**（塌陷！）
   - `.cornerstone-element`：w=1136 **h=0**
   - `canvas.cornerstone-canvas`：w=1136 **h=0**（vtk 按 0 高容器创建/适配）
2. 对照组 MPR（渲染正常）的结构：`.mpr-grid-wrap > .viewer-grid(display:grid, 样式 .viewer-grid 自带 width/height:100%) > .viewport-cell`；
   **Volume3dViewport.tsx 直接 `.mpr-grid-wrap > .viewport-cell`，缺少 `.viewer-grid` 包装层** → block 级 `.viewport-cell` 高度由内容决定（内容 0 → 2px 边框）→ 黑屏。
3. console 无 error、初始化链路（enableElement→volume→setVolumesForViewports→resetCamera→ready）全部成功——唯一问题就是容器高度。

## 修复要求
1. `src/features/volume3d/Volume3dViewport.tsx`（挂载 useEffect 的 JSX，约 630-645 行）：
   仿照 `src/features/mpr/MprViewport.tsx` 485-502 行的结构，在 `.mpr-grid-wrap` 与 `.viewport-cell` 之间补
   `.viewer-grid` 包装层（`gridTemplateColumns: 'minmax(0, 1fr)'`、`gridTemplateRows: 'minmax(0, 1fr)'`），
   使 `.viewport-cell`/`.cornerstone-element` 撑满 wrap。保持现有 props/ref 绑定（elementRef 仍指向 .cornerstone-element）。
2. 顺手补 3D 视口容器尺寸变化的 ResizeObserver + `renderingEngine.resize(true, true)`（参照 MPR/2D 既有实现，技能 P4 坑：布局切换后 canvas 尺寸/相机不更新会拉伸变形）。若 MPR 有现成 hook 可复用则复用，不要另造轮子。**若发现 MPR 也没有 resize 处理，只修 3D 本次范围，MPR 留 TODO 注释说明。**
3. 更新/新增单测：对 Volume3dViewport 渲染结构断言 `.viewer-grid` 包装存在（mock cornerstone 环境下渲染组件，检查容器层级）；若既有 m11 测试断容器结构记得同步。
4. 不改 gate/volume 构建/入口逻辑（那些是对的，本次只修布局）。

## 约束
- 内存紧张：只跑 `npx tsc --noEmit` + 涉及测试文件，禁止全量 vitest/build（监督方复跑）。
- 独立 commit（`<type>(<scope>): 描述`）+ `git push origin master`（失败报告即可）。
- 不写 Home 外目录；范围克制。
- stdout 简报：改动文件 + 测试结果；**不要自行跑 Playwright**（监督方负责 GUI 复测）。