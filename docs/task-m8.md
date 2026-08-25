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

# 任务书 M8：PACS 联网 DICOMweb

## 背景
当前 git 状态：
cbd533d docs: 夜间任务书 m7(自动生成)
f4c6913 night(task-m6): via opencode qwen3.8-27b, gate=OK, 25min
26553b1 docs: 夜间任务书 m6(自动生成)
f71aab6 docs: 夜间任务书 m5(自动生成)
d4f410a docs: 夜间任务书 m4(自动生成)
ad8990a docs: 夜间任务书 m3(自动生成)
a70a1fb night(task-m2-fix1): via opencode qwen3.8-27b, gate=OK, 71min
7677def fix(viewer): 关闭序列后清空视口图像（viewport.clear）
0b3e070 docs: M2 验收缺陷任务书(关闭序列视口残留)
f8892f9 docs: M2 报告


## 范围
需求范围：FR-13、AC-23~27

优先级建议：① DICOMweb 服务器配置界面(URL/QIDO/WADO-RS前缀+认证头)与连接测试 ② 查询(study/series QIDO)+拉取(WADO)入现有序列树，来源标记'远程' ③ 错误处理与超时。网关C-ECHO/C-FIND/C-MOVE属P2可TODO。注意：网络层全部走可注入 fetch，单测 mock。
## 策略（时间有限，抓大放小）
- 只实现各 FR 中 P0 条目的核心路径，P1/P2 一律 TODO 注释留名。
- UI 从简（能用现有面板/下拉承载就复用）。
- 单测覆盖核心逻辑分支（数据门槛、状态机、API调用链 mock 断言），不追求像素级。
- 如果评估后认为在本任务书时间内只能安全交付一半子项，宁可少而稳：把已做部分完整交付（build+test 绿），其余写进 TODO 并在简报里明确说"未做清单"。

## 输出
commit（不push）+ stdout 简报：做了/没做两个清单。
