/**
 * M1 验收缺陷回归：多帧 DICOM 翻页不换帧。
 *
 * 根因：NATURALIZED 元数据中多帧 PixelData 为单缓冲数组（length=1）时，
 * COMPRESSED_FRAME_DATA 管线无法按 frameIndex 取回第 ≥2 帧
 * （"no pixel data in NATURALIZED for imageId ...?frame=N"），
 * 修复为挂载后原地拆分为逐帧缓冲（长度 = NumberOfFrames）。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Enums, metaData, registerDefaultProviders } from '@cornerstonejs/metadata';
import {
  createDcmFileImageId,
  ensureDcmFileMetadata,
  splitNaturalizedPixelDataIntoFrames,
} from '../src/dicom/imageId';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

const NATURALIZED = Enums.MetadataModules.NATURALIZED;
const COMPRESSED_FRAME_DATA = Enums.MetadataModules.COMPRESSED_FRAME_DATA;

beforeAll(() => {
  registerDefaultProviders();
});

/** COMPRESSED_FRAME_DATA.pixelData 可能是单视图、视图数组或嵌套片段（与 concatPixelData 输入一致） */
function asPixelView(pixelData: unknown): Uint8Array {
  let raw = Array.isArray(pixelData) ? pixelData[0] : pixelData;
  while (Array.isArray(raw)) {
    raw = raw[0];
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  return raw as Uint8Array;
}

function pixelByteLength(pixelData: unknown): number {
  return asPixelView(pixelData).byteLength;
}

function firstPixelValue(pixelData: unknown): number {
  const view = asPixelView(pixelData);
  expect(view).toBeInstanceOf(Uint8Array);
  return new DataView(view.buffer, view.byteOffset, view.byteLength).getUint16(0, true);
}

/** 经加载器同款挂载路径后，按 ?frame=N（frameIndex=N-1）取回该帧像素首值与字节数 */
function getFrameData(imageId: string, frameNumber: number): { pixelData: unknown } | undefined {
  return metaData.getTyped(COMPRESSED_FRAME_DATA, `${imageId}?frame=${frameNumber}`, {
    frameIndex: frameNumber - 1,
  }) as { pixelData: unknown } | undefined;
}

describe('多帧 DICOM：NATURALIZED 逐帧像素管线', () => {
  it('3 帧文件挂载后 PixelData 拆为 3 份，各 ?frame=N 均可取到对应帧', async () => {
    const rows = 4;
    const columns = 5;
    const buffer = buildSyntheticDicom({ rows, columns, numberOfFrames: 3 });
    const baseImageId = createDcmFileImageId(buffer);

    // 与生产路径一致：用带 ?frame= 查询参数的 imageId 触发挂载
    await ensureDcmFileMetadata(`${baseImageId}?frame=2`);

    const natural = metaData.get(NATURALIZED, baseImageId) as Record<string, unknown>;
    expect(natural['NumberOfFrames']).toBe(3);
    const pixelData = natural['PixelData'];
    expect(Array.isArray(pixelData)).toBe(true);
    expect(pixelData as unknown[]).toHaveLength(3);

    const frameBytes = rows * columns * 2; // 8-bit SamplesPerPixel × 16 BitsAllocated
    for (let n = 1; n <= 3; n++) {
      const frameData = getFrameData(baseImageId, n);
      expect(frameData).toBeDefined();
      const pixel = Array.isArray(frameData?.pixelData)
        ? (frameData?.pixelData[0] as Uint8Array)
        : (frameData?.pixelData as Uint8Array);
      // 每帧 buffer 尺寸 = 帧像素字节数
      expect(pixel.byteLength).toBe(frameBytes);
      // 第 f 帧（0 起始）像素整体偏移 f × 帧像素数（见 syntheticDicom 编码规则）
      expect(firstPixelValue(frameData?.pixelData)).toBe((n - 1) * rows * columns);
    }
  });

  it('各帧像素内容互不相同（翻页时灰度可感知变化的前提）', async () => {
    const buffer = buildSyntheticDicom({ rows: 4, columns: 4, numberOfFrames: 3 });
    const baseImageId = createDcmFileImageId(buffer);
    await ensureDcmFileMetadata(`${baseImageId}?frame=1`);

    const values = [1, 2, 3].map((n) => firstPixelValue(getFrameData(baseImageId, n)?.pixelData));
    expect(new Set(values).size).toBe(3);
  });

  it.each([
    ['单缓冲条目', (merged: Uint8Array) => [merged]],
    ['片段数组条目（dcmjs 帧交付格式）', (merged: Uint8Array) => [[merged]]],
  ])('兜底修复：上游未拆帧（%s）时拆帧函数恢复逐帧取回能力', async (_label, wrap) => {
    const rows = 4;
    const columns = 4;
    const frames = 3;
    const frameBytes = rows * columns * 2;
    const buffer = buildSyntheticDicom({ rows, columns, numberOfFrames: frames });
    const baseImageId = createDcmFileImageId(buffer);
    await ensureDcmFileMetadata(`${baseImageId}?frame=1`);

    const natural = metaData.get(NATURALIZED, baseImageId) as Record<string, unknown>;
    // 复现验收文件形态：把逐帧数组合并回单一像素块（模拟上游未拆帧）
    const perFrame = natural['PixelData'] as unknown[];
    const merged = new Uint8Array(frameBytes * frames);
    perFrame.forEach((entry, i) => merged.set(asPixelView(entry), i * frameBytes));
    natural['PixelData'] = wrap(merged);

    // 缺陷复现：frame≥2 取不到像素（验收时的报错路径）
    expect(getFrameData(baseImageId, 2)).toBeUndefined();

    // 修复动作：原地拆分
    expect(splitNaturalizedPixelDataIntoFrames(natural)).toBe(true);

    // 恢复：每帧尺寸正确且内容对号入座
    for (let n = 1; n <= frames; n++) {
      const frameData = getFrameData(baseImageId, n);
      expect(frameData).toBeDefined();
      expect(pixelByteLength(frameData?.pixelData)).toBe(frameBytes);
      expect(firstPixelValue(frameData?.pixelData)).toBe((n - 1) * rows * columns);
    }
  });

  it('已按帧拆分的 PixelData 不重复处理；单帧文件不拆分', async () => {
    const multiBuffer = buildSyntheticDicom({ rows: 2, columns: 2, numberOfFrames: 2 });
    const multiBase = createDcmFileImageId(multiBuffer);
    await ensureDcmFileMetadata(multiBase);
    const multiNatural = metaData.get(NATURALIZED, multiBase) as Record<string, unknown>;
    expect(splitNaturalizedPixelDataIntoFrames(multiNatural)).toBe(false);

    const singleBuffer = buildSyntheticDicom({ rows: 2, columns: 2 });
    const singleNatural = { PixelData: [new Uint8Array(8)], Rows: 2, Columns: 2 };
    void singleBuffer;
    expect(splitNaturalizedPixelDataIntoFrames(singleNatural)).toBe(false);
  });
});
