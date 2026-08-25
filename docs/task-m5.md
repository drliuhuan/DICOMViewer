# 夜间自动任务书（护士进程生成）

## 全局约束（必须遵守）
- 项目：/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版本四包+dicom-parser 1.8.21+dcmjs）
- 本机无显示器无浏览器：一切验证靠单测（vitest/jsdom）。禁止启动 dev server 等待人工确认。
- 完成定义(DoD)：`npm run build`(含tsc) 通过；`npx vitest run` 全绿（不许删/跳过既有测试）；`npx eslint src tests` 不新增 error。
- 新功能必须带单测（mock @cornerstonejs/* 模块，参考既有 tests/m*.test.tsx 的 mock 手法）。
- 完成后自行 git commit（一行中文 message，格式 `<type>(<scope>): 描述（FR编号）`），但【不要】git push（监督进程统一推）。
- Cornerstone 已知坑：ToolGroup 必须 addTool 后才能 setToolActive；init 异步完成后才能 enableElement；events alias 别动。
- 范围克制：只做本任务书列的条目，不做"顺手重构"；UI 文案用简体中文。
- 若某子项确实无法完成（依赖缺失等），在代码中留 TODO 注释并在 commit message 里说明，不要阻塞其他子项。

# 任务书 M5：3D 体绘制（FR-7 P0 子集）

## 背景
当前 git 状态：
d4f410a docs: 夜间任务书 m4(自动生成)
ad8990a docs: 夜间任务书 m3(自动生成)
a70a1fb night(task-m2-fix1): via opencode qwen3.8-27b, gate=OK, 71min
7677def fix(viewer): 关闭序列后清空视口图像（viewport.clear）
0b3e070 docs: M2 验收缺陷任务书(关闭序列视口残留)
f8892f9 docs: M2 报告
91936e3 feat(app): 数据集关闭与资源释放 + 清空全部二次确认（FR-2.9）
04adb8f feat(series): 序列首帧缩略图与缓存上限（FR-2.4）
81b9cad feat(series): 实例排序补全 SliceLocation→IPP 法向量投影链（FR-2.3）
cb186af feat(ui): 序列面板升级为患者→检查→序列树 + 视口序列角标（FR-2.1/2.2/2.7/2.8）


## 交付目标
1. **FR-7.1 体绘制**：基于已有 volume（M4 的 volume 缓存复用）用 vtk.js 光线投射（cornerstone VolumeViewport3D + volumeActor），支持旋转/平移/缩放。
2. **FR-7.2 渲染预设**：CT-Bone、CT-Angio、CT-Soft-Tissue、CT-Skin、MIP 五预设（颜色+不透明度传递函数），下拉切换。
3. **FR-7.9 复位视角**：一键恢复默认轴位俯视。
4. **FR-7.8 3D截图(P1)**：当前视角导出 PNG（canvas.toBlob 下载）。
5. 布局：3D 作为第四视口加入 MPR 布局（2×2 的第4格），或独立模式二选一，选实现简单的。

## 明确不做
FR-7.4/7.5 裁剪、FR-7.6 渐进渲染、FR-7.7 质量档位、FR-7.10 等值面 —— TODO 注释。

## 单测要求
- 预设表完整性测试（5预设、名称、传递函数关键点非空）。
- 3D 入口数据门槛（无 volume 时禁用+提示）。
- 复位视角调用断言（camera reset API 参数）。
- vtk actor 创建链 mock 断言。

## 输出
commit（不push）+ stdout 简报。
