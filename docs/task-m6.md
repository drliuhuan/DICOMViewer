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

# 任务书 M6：增强功能包

## 背景
当前 git 状态：
f71aab6 docs: 夜间任务书 m5(自动生成)
d4f410a docs: 夜间任务书 m4(自动生成)
ad8990a docs: 夜间任务书 m3(自动生成)
a70a1fb night(task-m2-fix1): via opencode qwen3.8-27b, gate=OK, 71min
7677def fix(viewer): 关闭序列后清空视口图像（viewport.clear）
0b3e070 docs: M2 验收缺陷任务书(关闭序列视口残留)
f8892f9 docs: M2 报告
91936e3 feat(app): 数据集关闭与资源释放 + 清空全部二次确认（FR-2.9）
04adb8f feat(series): 序列首帧缩略图与缓存上限（FR-2.4）
81b9cad feat(series): 实例排序补全 SliceLocation→IPP 法向量投影链（FR-2.3）


## 范围
需求范围：需求清单 FR-8(分割)、FR-9(融合)、FR-10(导出)、FR-1.15/16/17、Tag浏览器

优先级建议：① Tag 浏览器(纯前端读 metadata，独立性好) ② 截图导出PNG+标注JSON导出/导入(FR-10) ③ 阈值分割+3D叠加(FR-8.3/8.5 SEG导出可缓) ④ PET/CT融合基础版(FR-9.4/9.5)。
## 策略（时间有限，抓大放小）
- 只实现各 FR 中 P0 条目的核心路径，P1/P2 一律 TODO 注释留名。
- UI 从简（能用现有面板/下拉承载就复用）。
- 单测覆盖核心逻辑分支（数据门槛、状态机、API调用链 mock 断言），不追求像素级。
- 如果评估后认为在本任务书时间内只能安全交付一半子项，宁可少而稳：把已做部分完整交付（build+test 绿），其余写进 TODO 并在简报里明确说"未做清单"。

## 输出
commit（不push）+ stdout 简报：做了/没做两个清单。
