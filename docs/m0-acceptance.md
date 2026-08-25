# M0 真机验收补充报告

> 2026-08-25,由 Hermes 主 agent 用 headless Chromium(Playwright)完成 OpenCode 无法做的 GUI 验收。

## 验收方法
1. `npm run preview` 起 dist 静态服务(:4180)
2. Python 生成最小合法 CT Part-10 文件(16×16 灰阶斜坡,显式 VR 小端)
3. Playwright 注入 File → input[type=file] change 事件
4. 断言: canvas 存在、信息覆盖文字正确、页面无 JS 错误、截图人工复核

## 发现并修复的 Bug(2 个)

### Bug 1(阻断级): 应用启动即白屏崩溃
- **现象**: 页面完全空白,`Class extends value undefined is not a constructor or null`,root 未挂载
- **定位**: 崩溃堆栈 → vendor chunk → `xmlbuilder2`(vtk.js 的传递依赖,被 `@cornerstonejs/metadata` 引入)→ `XMLBuilderCBImpl extends events_1.EventEmitter` → `events` 是 Node 内置模块,Vite 浏览器产物把它解析成空对象
- **修复**: `vite.config.ts` 加 `resolve.alias { events: 'events/' }` + devDep `events@3.3.0`(浏览器 polyfill)

### Bug 2(测试数据): 合成 DICOM 缺 FileMetaInformationGroupLength
- **现象**: 注入文件后报 `meta length tag is malformed or not present`,图像不渲染
- **定位**: dcmjs `AsyncDicomReader.readMeta` 严格要求 (0002,0000) 是 file meta 第一个元素;dicom-parser 宽松所以单测通过、dcmjs 严格所以运行时失败——两个解析器行为差异被 GUI 验收暴露
- **修复**: 生成器改为先构造 meta 主体算长度,把 group length 作为首个元素写入(测试数据问题,非应用代码问题)

## 最终验收结果
- ✅ 页面正常挂载,无 JS 错误(剩 1 个 404 为 favicon,无碍)
- ✅ canvas 渲染 16×16 灰阶渐变斜坡,与像素数据一致
- ✅ 信息覆盖文字: PatientName=M0^GUI^ACCEPT / Modality=CT / Rows×Cols=16×16
- ✅ 底部状态栏: 文件名/大小/SOP UID
- ✅ `npm run build` / `vitest 6 passed` / `tsc --noEmit` 全绿
- 截图: ~/.hermes/workspace/m0-gui-1787626584.png

## 结论
M0 验收入口「打开一个 DICOM 文件显示图像」在真实浏览器中通过。可进入 M1(基础阅片: WW/WL、缩放、平移、翻页)。
