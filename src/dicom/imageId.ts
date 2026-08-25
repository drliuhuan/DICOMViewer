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

/**
 * 从 imageId 取出注册表 key。
 * 多帧文件使用 `dcm-file://<key>?frame=N` 形式（N 为 1 起始帧号，
 * 由 dicom-image-loader/metadata 的标准 frame 查询参数管线解析），
 * 注册表查找时须剥离查询串。
 */
function parseKey(imageId: string): string | undefined {
  if (!imageId.startsWith(IMAGE_ID_PREFIX)) {
    return undefined;
  }
  const rest = imageId.slice(IMAGE_ID_PREFIX.length);
  const queryIndex = rest.indexOf('?');
  return queryIndex === -1 ? rest : rest.slice(0, queryIndex);
}

/**
 * 登记一个内存中的 DICOM Part-10 缓冲区并生成对应 imageId。
 * @param buffer 完整的 Part-10 字节流
 * @returns `dcm-file://<uuid>` 形式的 imageId（多帧时追加 `?frame=N`）
 */
export function createDcmFileImageId(buffer: ArrayBuffer): string {
  const key = crypto.randomUUID();
  bufferRegistry.set(key, buffer);
  return `${IMAGE_ID_PREFIX}${key}`;
}

/** 生成指向 base imageId 第 frameNumber 帧（1 起始）的多帧 imageId。 */
export function withFrameNumber(baseImageId: string, frameNumber: number): string {
  const separator = baseImageId.includes('?') ? '&' : '?';
  return `${baseImageId}${separator}frame=${frameNumber}`;
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

/** 已完成 NATURALIZED 元数据登记的 base imageId 集合，避免逐帧重复解析 */
const registeredBaseImageIds = new Set<string>();

async function loadDcmFileImage(imageId: string): Promise<Types.IImage> {
  const [{ utilities }, { loadImageFromNaturalizedMetadata }] = await Promise.all([
    import('@cornerstonejs/metadata'),
    import('@cornerstonejs/dicom-image-loader/wadouri'),
  ]);
  // 预置 NATURALIZED 元数据（从内存 ArrayBuffer 解析），使后续管线无需任何 IO。
  // 多帧 imageId 的元数据统一挂在剥离 frame 参数的 base imageId 上，
  // 逐帧像素由 dicom-image-loader/metadata 的 frame 查询参数管线取回。
  const queryIndex = imageId.indexOf('?');
  const baseImageId = queryIndex === -1 ? imageId : imageId.slice(0, queryIndex);
  if (!registeredBaseImageIds.has(baseImageId)) {
    await utilities.addDicomPart10Instance(baseImageId, getBufferForImageId(baseImageId));
    registeredBaseImageIds.add(baseImageId);
  }
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
