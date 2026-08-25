/**
 * M2-H 序列缩略图测试（FR-2.4）：
 * 像素提取/降采样/灰度归一化纯逻辑（canvas 以桩对象注入）+ 缓存上限淘汰。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  THUMBNAIL_MAX_COUNT,
  clearThumbnails,
  generateThumbnail,
  getThumbnail,
  readFirstFramePixels,
  renderFrameToCanvas,
  setThumbnail,
  thumbnailCount,
  type ThumbnailCanvasLike,
} from '../src/features/series/thumbnails';
import { parseDicomArrayBuffer } from '../src/dicom/parseDicom';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

/** 记录绘制调用的 canvas 桩 */
function makeCanvasStub() {
  const calls: Array<{ width: number; height: number; dataLength: number }> = [];
  const canvas: ThumbnailCanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (imageData: { data: Uint8ClampedArray }) => {
        calls.push({
          width: canvas.width,
          height: canvas.height,
          dataLength: imageData.data.length,
        });
      },
    }),
    toDataURL: () => 'data:image/png;base64,stub',
  };
  return { canvas, calls };
}

beforeEach(() => {
  clearThumbnails();
});

describe('readFirstFramePixels', () => {
  it('读取首帧尺寸与像素数（16bit 无符号小端）', () => {
    const dataSet = parseDicomArrayBuffer(
      buildSyntheticDicom({ rows: 8, columns: 6, numberOfFrames: 2 }),
    );
    const frame = readFirstFramePixels(dataSet);
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(6);
    expect(frame?.height).toBe(8);
    expect(frame?.samples).toHaveLength(48);
    // 多帧文件仅取第一帧字节：首像素值 0、次像素值 1
    expect(frame?.samples[0]).toBe(0);
    expect(frame?.samples[1]).toBe(1);
  });
});

describe('renderFrameToCanvas', () => {
  it('按 maxSize 最近邻降采样并保持纵横比', () => {
    const frame = {
      width: 32,
      height: 16,
      samples: new Int32Array(32 * 16).fill(100),
    };
    const { canvas, calls } = makeCanvasStub();
    const dataUrl = renderFrameToCanvas(frame, canvas, 8);
    expect(dataUrl).toContain('data:image/png');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.width).toBe(8);
    expect(calls[0]?.height).toBe(4); // 16 × (8/32) = 4
    expect(calls[0]?.dataLength).toBe(8 * 4 * 4);
  });

  it('min-max 归一化：渐变像素映射到 0..255 灰度，RGBA alpha 恒为 255', () => {
    const width = 4;
    const samples = new Int32Array(width * 1).map((_, i) => i * 100); // 0,100,...,300
    const { canvas } = makeCanvasStub();
    let captured: Uint8ClampedArray | null = null;
    const spyCanvas: ThumbnailCanvasLike = {
      ...canvas,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: (imageData: unknown) => {
          captured = (imageData as { data: Uint8ClampedArray }).data;
        },
      }),
    };
    renderFrameToCanvas({ width, height: 1, samples }, spyCanvas, 64);
    const rgba = captured as unknown as Uint8ClampedArray;
    expect(rgba[0]).toBe(0); // min → 黑
    expect(rgba[(width - 1) * 4]).toBe(255); // max → 白
    expect(rgba[3]).toBe(255);
  });
});

describe('generateThumbnail', () => {
  it('未压缩 DICOM 缓冲 → 返回 dataURL', () => {
    const { canvas } = makeCanvasStub();
    const result = generateThumbnail(buildSyntheticDicom(), { canvas });
    expect(result).toContain('data:image/');
  });

  it('压缩传输语法返回 null（回退占位图标）', () => {
    const buffer = buildSyntheticDicom({
      transferSyntaxUid: '1.2.840.10008.1.2.4.50',
    });
    expect(generateThumbnail(buffer, { canvas: makeCanvasStub().canvas })).toBeNull();
  });

  it('非 DICOM 缓冲返回 null 而不抛错', () => {
    const text = new TextEncoder().encode('plain text').buffer as ArrayBuffer;
    expect(generateThumbnail(text, { canvas: makeCanvasStub().canvas })).toBeNull();
  });

  it('无 canvas 可用时返回 null', () => {
    expect(generateThumbnail(buildSyntheticDicom())).toBeNull(); // Node 环境无 document
  });
});

describe('缩略图缓存（上限 100）', () => {
  it('超出上限时淘汰最早写入的条目', () => {
    for (let i = 0; i < THUMBNAIL_MAX_COUNT + 10; i++) {
      setThumbnail(`uid-${i}`, `url-${i}`);
    }
    expect(thumbnailCount()).toBe(THUMBNAIL_MAX_COUNT);
    expect(getThumbnail('uid-0')).toBeUndefined(); // 最早写入被淘汰
    expect(getThumbnail('uid-9')).toBeUndefined(); // 淘汰的 10 个：uid-0..uid-9
    expect(getThumbnail('uid-10')).toBeDefined();
    expect(getThumbnail(`uid-${THUMBNAIL_MAX_COUNT}`)).toBe('url-100'); // 最新保留
  });

  it('clearThumbnails 清空缓存', () => {
    setThumbnail('a', 'url-a');
    expect(thumbnailCount()).toBe(1);
    clearThumbnails();
    expect(thumbnailCount()).toBe(0);
    expect(getThumbnail('a')).toBeUndefined();
  });
});
