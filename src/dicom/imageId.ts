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

/**
 * NATURALIZED 元数据中像素数据可能出现的键名，
 * 与 @cornerstonejs/metadata compressedFrameData 的查找顺序一致。
 */
const PIXEL_DATA_KEYS = [
  'PixelData',
  'FramePixelData',
  'FloatPixelData',
  '7FE00010',
  '7fe00010',
  '7FE00008',
  '7fe00008',
] as const;

function findPixelDataEntry(
  natural: Record<string, unknown>,
): { key: string; frames: unknown[] } | undefined {
  for (const key of PIXEL_DATA_KEYS) {
    const value = natural[key];
    if (Array.isArray(value) && value.length > 0) {
      return { key, frames: value };
    }
  }
  return undefined;
}

function toUint8View(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function isBytes(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/** 深度优先收集任意嵌套数组中的字节缓冲片段 */
function collectByteViews(value: unknown, out: Uint8Array[]): void {
  if (isBytes(value)) {
    out.push(toUint8View(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectByteViews(item, out);
    }
  }
}

/**
 * 取出像素数据条目承载的连续字节。
 * dcmjs 可能以单缓冲或「逐帧片段数组」（帧内再分片的 `Array<ArrayBuffer>`）交付，
 * 单一片段直接返回视图，多片段则拼接为连续缓冲。
 */
function extractContiguousBytes(value: unknown): Uint8Array | undefined {
  const parts: Uint8Array[] = [];
  collectByteViews(value, parts);
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined;
}

function toIntCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * 将 NATURALIZED 元数据中的单缓冲 PixelData 原地拆分为逐帧缓冲。
 *
 * 背景（M1 验收缺陷）：多帧文件的 COMPRESSED_FRAME_DATA 查询
 * （`metaData.getTyped(COMPRESSED_FRAME_DATA, imageId, { frameIndex })`）
 * 仅当 `PixelData` 数组长度等于 NumberOfFrames 时才能按帧取回；
 * 上游 dcmjs 解析器对部分文件不拆帧（PixelData 为长度 1 的单条目数组，
 * 条目为整份像素缓冲或其片段数组），且库内单条目兜底切分只对
 * FloatPixelData（paramap）类型生效，
 * 导致 frame≥1 全部报 "no pixel data in NATURALIZED"。
 *
 * @returns 是否发生了原地修改
 */
export function splitNaturalizedPixelDataIntoFrames(natural: Record<string, unknown>): boolean {
  const numberOfFrames = toIntCount(natural['NumberOfFrames']);
  if (!Number.isFinite(numberOfFrames) || numberOfFrames <= 1) {
    return false;
  }
  const entry = findPixelDataEntry(natural);
  if (!entry || entry.frames.length !== 1) {
    return false;
  }
  // 上游未拆帧时唯一条目可能是单缓冲，也可能是嵌套的片段数组（dcmjs 帧交付格式）
  const whole = extractContiguousBytes(entry.frames[0]);
  if (!whole || whole.byteLength === 0) {
    return false;
  }

  const rows = toIntCount(natural['Rows']);
  const columns = toIntCount(natural['Columns']);
  const samplesPerPixel = toIntCount(natural['SamplesPerPixel'] ?? 1);
  const bitsAllocated = toIntCount(natural['BitsAllocated']);
  let frameBytes = rows * columns * samplesPerPixel * Math.ceil(bitsAllocated / 8);
  if (
    !Number.isFinite(frameBytes) ||
    frameBytes <= 0 ||
    whole.byteLength !== frameBytes * numberOfFrames
  ) {
    // 元数据推算的帧大小与实际不符时，退化为整除均分；无法整除则放弃
    if (whole.byteLength % numberOfFrames !== 0) {
      return false;
    }
    frameBytes = whole.byteLength / numberOfFrames;
  }

  const perFrame: Uint8Array[] = [];
  for (let index = 0; index < numberOfFrames; index++) {
    perFrame.push(whole.subarray(index * frameBytes, (index + 1) * frameBytes));
  }
  natural[entry.key] = perFrame;
  return true;
}

/**
 * 确保 imageId（可含 ?frame=N 查询参数）对应的 Part-10 缓冲已完成
 * NATURALIZED 元数据挂载，且多帧像素数据已按帧拆分到位。
 *
 * 元数据统一挂在剥离 frame 参数的 base imageId 上（库内 BASE_IMAGE_ID
 * 过滤器会自动剥离查询串）；逐帧像素随后由 COMPRESSED_FRAME_DATA
 * 管线按 frameIndex 取回。
 */
export async function ensureDcmFileMetadata(imageId: string): Promise<void> {
  const { utilities } = await import('@cornerstonejs/metadata');
  const queryIndex = imageId.indexOf('?');
  const baseImageId = queryIndex === -1 ? imageId : imageId.slice(0, queryIndex);
  if (registeredBaseImageIds.has(baseImageId)) {
    return;
  }
  // addDicomPart10Instance 的返回类型标注为 Promise<never>（上游标注缺陷），
  // 实际 resolve 值是解析后的 NATURALIZED 字典对象。
  const naturalized = (await utilities.addDicomPart10Instance(
    baseImageId,
    getBufferForImageId(baseImageId),
  )) as unknown;
  if (typeof naturalized === 'object' && naturalized !== null) {
    // 元数据缓存持有同一对象引用，原地拆帧即对全部查询方生效
    splitNaturalizedPixelDataIntoFrames(naturalized as Record<string, unknown>);
  }
  registeredBaseImageIds.add(baseImageId);
}

async function loadDcmFileImage(imageId: string): Promise<Types.IImage> {
  const [, { loadImageFromNaturalizedMetadata }] = await Promise.all([
    ensureDcmFileMetadata(imageId),
    import('@cornerstonejs/dicom-image-loader/wadouri'),
  ]);
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
