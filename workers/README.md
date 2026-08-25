# workers/ — Web Worker

M0 阶段像素解码使用 @cornerstonejs/dicom-image-loader 内置的 decode worker
（由 `src/dicom/init.ts` 中 `init()` 注册，Vite 自动打包 `new URL(..., import.meta.url)` worker）。

自研 Worker（元数据解析池、体数据构建等，需求 §7.3-2）在后续里程碑放入本目录。
