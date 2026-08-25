/**
 * Cornerstone3D 渲染/解析管线的统一初始化入口。
 *
 * - @cornerstonejs/core init：检测 GPU/CPU 渲染后端；
 * - @cornerstonejs/dicom-image-loader init：注册解码 Web Worker 池，
 *   所有传输语法（含未压缩）的像素解码均派发至 Worker，不阻塞主线程；
 * - 注册自定义 `dcm-file://` 图像加载器（见 imageId.ts）。
 *
 * 单例化：任意入口多次调用只会初始化一次。
 */
import { init as initCornerstoneCore } from '@cornerstonejs/core';
import { init as initDicomImageLoader } from '@cornerstonejs/dicom-image-loader';
import { registerDcmFileImageLoader } from './imageId';

let pipelinePromise: Promise<void> | null = null;

async function doInitialize(): Promise<void> {
  initCornerstoneCore();
  await registerDcmFileImageLoader();
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  initDicomImageLoader({
    maxWebWorkers: Math.max(
      1,
      Math.min(4, Math.floor((hardwareConcurrency ?? 2) / 2)),
    ),
    strict: false,
  });
}

/** 初始化完整渲染/解析管线；幂等，返回共享的初始化 Promise。 */
export function initializeDicomPipeline(): Promise<void> {
  pipelinePromise ??= doInitialize();
  return pipelinePromise;
}
