# 任务书 M11-F1：按钮全局只显示图标（去掉桌面端文字）

## 项目
/home/drliuhuan/DICOMViewer（React18+TS5+Vite5+Cornerstone3D 5.8.2 锁版）

## 需求（用户真机反馈，明确指令）
上一轮 M11 按钮图标化做了「桌面 icon+文字双显、≤767px 仅图标」。用户实际操作后反馈：
**功能区已显示不开了**——要求**所有尺寸一律只显示图标，不要文字**。

## 改动要求
1. `src/app/styles.css` 第 1658-1664 行：`.tool-button-label` 目前只在 `@media (max-width: 767px)` 内 `display:none`。
   改为**全局隐藏**（把 `display:none` 提到媒体查询外，或删除媒体查询让规则全局生效，二选一，保持 CSS 整洁）。
2. 顺手检查工具栏/功能区布局：隐藏文字后若仍存在溢出/挤占（flex-wrap、min-width、overflow 配置），一并修正，保证图标按钮排得开。
3. 文案仍保留在 DOM（`textContent` 断言不受影响），只是不可见。**不要**删除 `.tool-button-label` span 本身。
4. 检查 `tests/m11.iconButtons.test.tsx` 及任何断言「桌面端 icon+文字双显」的既有测试：断言与「仅图标」语义冲突的，如实更新断言并列出改了哪几条；未冲突的测试不得改动。

## 约束
- 内存紧张：只跑 `npx tsc --noEmit` + 涉及测试文件（m11.iconButtons 及相关工具栏测试），禁止全量 vitest/build（监督方复跑）。
- 独立 commit（message 格式 `<type>(<scope>): 描述`）+ `git push origin master`（push 失败报告即可，监督方补推）。
- 不写 Home 外目录；范围克制，只做本任务书条目。
- stdout 简报：改动清单 + 更新了哪些测试断言 + 实际验证命令与结果。