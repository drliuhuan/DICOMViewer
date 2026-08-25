/**
 * 序列缩略图生成与缓存（FR-2.4，M2-H）。
 *
 * - 从内存中的 Part-10 缓冲直接读取首帧像素（仅未压缩传输语法），
 *   最近邻降采样到上限尺寸、min-max 灰度归一化，离屏 canvas 渲染为 dataURL；
 * - 模块级缓存按序列 uid 存取，容量上限 100 条（LRU 近似：超出淘汰最早写入），
 *   超出后新序列显示占位图标；
 * - canvas 通过参数注入（默认 document.createElement），便于 Node 下单测。
 *
 * 已知限制（P1）：不支持压缩传输语法/彩色像素的缩略图（回退占位图标）。
 */
import { parseDicomArrayBuffer } from '../../dicom/parseDicom';

/** 缓存容量上限；超过后不再为新序列生成缩略图 */
export const THUMBNAIL_MAX_COUNT = 100;

export interface Canvas2DContextLike {
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(imageData: unknown, dx: number, dy: number): void;
}

export interface ThumbnailCanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Canvas2DContextLike | null;
  toDataURL(type?: string): string;
}

/** 可直接从内存缓冲解码的未压缩传输语法 */
const UNCOMPRESSED_TRANSFER_SYNTAXES = new Set([
  '1.2.840.10008.1.2', // Implicit VR Little Endian
  '1.2.840.10008.1.2.1', // Explicit VR Little Endian
  '1.2.840.10008.1.2.2', // Explicit VR Big Endian
]);

interface RawFrame {
  width: number;
  height: number;
  samples: Int32Array;
}

function toInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 从数据集读取首帧灰度像素（多帧文件取第一帧的字节范围） */
export function readFirstFramePixels(dataSet: ReturnType<typeof parseDicomArrayBuffer>): RawFrame | null {
  const element = dataSet.elements['x7fe00010'];
  if (!element || (element.length ?? 0) <= 0) {
    return null;
  }
  const width = toInt(dataSet.uint16('x00280011'), 0);
  const height = toInt(dataSet.uint16('x00280010'), 0);
  if (width <= 0 || height <= 0) {
    return null;
  }
  const samplesPerPixel = toInt(dataSet.uint16('x00280002'), 1);
  if (samplesPerPixel !== 1) {
    return null; // 彩色图暂不生成缩略图
  }
  const bitsAllocated = toInt(dataSet.uint16('x00280100'), 16);
  const bytesPerSample = bitsAllocated === 8 ? 1 : bitsAllocated === 16 ? 2 : 0;
  if (bytesPerSample === 0) {
    return null;
  }
  const signed = toInt(dataSet.uint16('x00280103'), 0) === 1;
  const pixelCount = width * height;
  const frameBytes = pixelCount * bytesPerSample;
  if ((element.length ?? 0) < frameBytes) {
    return null;
  }
  const base = dataSet.byteArray as Uint8Array;
  const view = new DataView(
    base.buffer,
    base.byteOffset + element.dataOffset,
    frameBytes,
  );
  const samples = new Int32Array(pixelCount);
  for (let index = 0; index < pixelCount; index++) {
    samples[index] =
      bytesPerSample === 1
        ? view.getUint8(index)
        : signed
          ? view.getInt16(index * 2, true)
          : view.getUint16(index * 2, true);
  }
  return { width, height, samples };
}

/** min-max 归一化为 8bit 灰度 */
function normalizeToGray(samples: Int32Array): Uint8ClampedArray {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] as number;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  const gray = new Uint8ClampedArray(samples.length);
  for (let i = 0; i < samples.length; i++) {
    gray[i] = range > 0 ? Math.round((((samples[i] as number) - min) / range) * 255) : 128;
  }
  return gray;
}

/** 最近邻降采样 + RGBA 填充并绘制到画布 */
export function renderFrameToCanvas(
  frame: RawFrame,
  canvas: ThumbnailCanvasLike,
  maxSize: number,
): string {
  const scale = Math.min(1, maxSize / frame.width, maxSize / frame.height);
  const outWidth = Math.max(1, Math.round(frame.width * scale));
  const outHeight = Math.max(1, Math.round(frame.height * scale));
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('canvas 2d context 不可用');
  }
  const gray = normalizeToGray(frame.samples);
  const imageData = context.createImageData(outWidth, outHeight);
  const rgba = imageData.data;
  for (let y = 0; y < outHeight; y++) {
    const sourceY = Math.min(frame.height - 1, Math.floor(y / scale));
    for (let x = 0; x < outWidth; x++) {
      const sourceX = Math.min(frame.width - 1, Math.floor(x / scale));
      const value = gray[sourceY * frame.width + sourceX] ?? 0;
      const offset = (y * outWidth + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function createDefaultCanvas(maxSize: number): ThumbnailCanvasLike | null {
  if (typeof document === 'undefined') {
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = maxSize;
    canvas.height = maxSize;
    if (canvas.getContext('2d') === null) {
      return null;
    }
    return canvas;
  } catch {
    return null;
  }
}

/**
 * 从 DICOM Part-10 缓冲生成首帧缩略图 dataURL。
 * 非 DICOM / 压缩语法 / 彩色 / 异常一律返回 null（调用方显示占位图标）。
 */
export function generateThumbnail(
  buffer: ArrayBuffer,
  options: { maxSize?: number; canvas?: ThumbnailCanvasLike } = {},
): string | null {
  try {
    const transferSyntax = parseDicomArrayBuffer(buffer).string('x00020010');
    if (
      transferSyntax !== undefined &&
      !UNCOMPRESSED_TRANSFER_SYNTAXES.has(transferSyntax)
    ) {
      return null;
    }
    const dataSet = parseDicomArrayBuffer(buffer);
    const frame = readFirstFramePixels(dataSet);
    if (!frame) {
      return null;
    }
    const maxSize = options.maxSize ?? 96;
    const canvas = options.canvas ?? createDefaultCanvas(maxSize);
    if (!canvas) {
      return null;
    }
    return renderFrameToCanvas(frame, canvas, maxSize);
  } catch {
    return null;
  }
}

// ── 模块级缓存（uid → dataURL），releaseAll 时清空 ──
const thumbnailCache = new Map<string, string>();

export function getThumbnail(seriesUid: string): string | undefined {
  return thumbnailCache.get(seriesUid);
}

/** 写入缓存；达到上限且为新键时淘汰最早写入的条目 */
export function setThumbnail(seriesUid: string, dataUrl: string): void {
  if (!thumbnailCache.has(seriesUid) && thumbnailCache.size >= THUMBNAIL_MAX_COUNT) {
    const oldest = thumbnailCache.keys().next();
    if (!oldest.done) {
      thumbnailCache.delete(oldest.value);
    }
  }
  thumbnailCache.set(seriesUid, dataUrl);
}

export function clearThumbnails(): void {
  thumbnailCache.clear();
}

/** 当前缓存条数（测试/诊断用） */
export function thumbnailCount(): number {
  return thumbnailCache.size;
}
