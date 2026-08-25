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

# 任务书 M4：MPR 多平面重建（FR-6 P0 子集）

## 背景
当前 git 状态：
ad8990a docs: 夜间任务书 m3(自动生成)
a70a1fb night(task-m2-fix1): via opencode qwen3.8-27b, gate=OK, 71min
7677def fix(viewer): 关闭序列后清空视口图像（viewport.clear）
0b3e070 docs: M2 验收缺陷任务书(关闭序列视口残留)
f8892f9 docs: M2 报告
91936e3 feat(app): 数据集关闭与资源释放 + 清空全部二次确认（FR-2.9）
04adb8f feat(series): 序列首帧缩略图与缓存上限（FR-2.4）
81b9cad feat(series): 实例排序补全 SliceLocation→IPP 法向量投影链（FR-2.3）
cb186af feat(ui): 序列面板升级为患者→检查→序列树 + 视口序列角标（FR-2.1/2.2/2.7/2.8）
55b2c7c feat(series): SOPInstanceUID 文件去重与跨批次累积加载（FR-1.11）


## 前置说明
- 体数据构建：用 cornerstone volume loader 从已加载的 series imageIds 建 Volume（@cornerstonejs/core volumeLoader.createAndCacheVolume + stream 方式均可）。
- 层数<2、缺 PixelSpacing/IPP 时禁用 MPR 入口并 toast 提示原因（FR-6.7）。

## 交付目标（P0 全做，P1 尽量）
1. **FR-6.1 三平面**：Axial/Coronal/Sagittal 三视口布局（VolumeViewport），从现有布局按钮一键进入/退出（FR-6.9）。
2. **FR-6.2 交叉定位线**：每平面显示另两平面的交线，颜色遵循医学惯例 红=矢状参考 绿=冠状 黄=轴向（crosshairs tool 或手绘 ReferenceLines）。
3. **FR-6.3 三平面联动**：拖定位线或滚轮滚动，三平面实时更新（≤150ms 目标，Volume API GPU 重采样）。
4. **FR-6.6 基础操作继承**：MPR 视口支持 WW/WL、缩放、平移（测量继承允许降级为 TODO）。
5. **FR-6.9 布局切换**：MPR 模式布局模板 + 一键回 2D 单视口。

## 明确不做
FR-6.4 厚度模式(MIP/平均)、FR-6.5 斜切、FR-6.10 参考线随动 —— 留 TODO 注释。

## 单测要求
- 布局切换逻辑（非渲染层）：进入 MPR → viewport 数量与类型断言；退出恢复。
- 数据门槛：<2 层序列禁用逻辑；IPP 缺失禁用逻辑。
- volume 构建调用链 mock 断言（createAndCacheVolume 被正确调用、方向参数正确）。
- 定位线颜色映射常量测试（红绿黄对应关系）。
- 渲染联动本身难以 jsdom 测试的部分，用"调用了 cornerstone 正确 API+参数"级别的 mock 断言覆盖。

## 输出
commit（不push）+ stdout 简报：FR 清单完成状态 + 单测统计。
