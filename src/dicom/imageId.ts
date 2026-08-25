/**
 * 自定义 imageId scheme：`dcm-file://<key>`（需求 §7.3-1）。
 *
 * 设计：
 * - 文件内容以 ArrayBuffer 形式驻留内存，注册表持有 key → buffer 映射；
 * - 加载器从 ArrayBuffer 直接解码，不经过磁盘 IO 中间层；
 * - 解码前通过 `addDicomPart10Instance` 将缓冲区挂到
 *   @cornerstonejs/metadata 的 NATURALIZED 元数据存储上，
 *   随后复用 dicom-image-loader 的标准解码管线（含 Web Worker）。
 *
 * 本模块刻意避免顶层 import cornerstone 重依赖（动态 import），
 * 以便纯函数部分可在 Node 环境（Vitest）下直接测试。
 */
import type { Types } from '@cornerstonejs/core';

/** imageId scheme 名，注册到 Cornerstone imageLoader 时使用 */
export const DCM_FILE_SCHEME = 'dcm-file';

const IMAGE_ID_PREFIX = `${DCM_FILE_SCHEME}://`;

/** 内存缓冲注册表：key → DICOM Part-10 ArrayBuffer */
const bufferRegistry = new Map<string, ArrayBuffer>();

let registerPromise: Promise<void> | null = null;

function parseKey(imageId: string): string | undefined {
  if (!imageId.startsWith(IMAGE_ID_PREFIX)) {
    return undefined;
  }
  return imageId.slice(IMAGE_ID_PREFIX.length);
}

/**
 * 登记一个内存中的 DICOM Part-10 缓冲区并生成对应 imageId。
 * @param buffer 完整的 Part-10 字节流
 * @returns `dcm-file://<uuid>` 形式的 imageId
 */
export function createDcmFileImageId(buffer: ArrayBuffer): string {
  const key = crypto.randomUUID();
  bufferRegistry.set(key, buffer);
  return `${IMAGE_ID_PREFIX}${key}`;
}

/** 取回 imageId 对应的原始缓冲区；非本 scheme 或未登记时抛错。 */
export function getBufferForImageId(imageId: string): ArrayBuffer {
  const key = parseKey(imageId);
  const buffer = key === undefined ? undefined : bufferRegistry.get(key);
  if (buffer === undefined) {
    throw new Error(`dcm-file 注册表中不存在该 imageId 对应的缓冲区: ${imageId}`);
  }
  return buffer;
}

async function loadDcmFileImage(imageId: string): Promise<Types.IImage> {
  const [{ utilities }, { loadImageFromNaturalizedMetadata }] = await Promise.all([
    import('@cornerstonejs/metadata'),
    import('@cornerstonejs/dicom-image-loader/wadouri'),
  ]);
  // 预置 NATURALIZED 元数据（从内存 ArrayBuffer 解析），使后续管线无需任何 IO
  await utilities.addDicomPart10Instance(imageId, getBufferForImageId(imageId));
  const loadObject = loadImageFromNaturalizedMetadata(imageId);
  return loadObject.promise;
}

/**
 * 将 `dcm-file` scheme 的图像加载器注册进 Cornerstone。
 * 幂等：重复调用只生效一次。
 */
export function registerDcmFileImageLoader(): Promise<void> {
  registerPromise ??= (async () => {
    const { imageLoader } = await import('@cornerstonejs/core');
    imageLoader.registerImageLoader(DCM_FILE_SCHEME, (imageId) => ({
      promise: loadDcmFileImage(imageId),
    }));
  })();
  return registerPromise;
}
