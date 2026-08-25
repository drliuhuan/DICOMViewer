/**
 * M0 冒烟测试：
 * 1. 合成小 DICOM buffer → 解析封装返回预期 metadata；
 * 2. 非 DICOM / 截断文件 → 可见错误而非崩溃；
 * 3. dcm-file:// imageId 注册表 roundtrip。
 */
import { describe, expect, it } from 'vitest';
import {
  DCM_FILE_SCHEME,
  createDcmFileImageId,
  getBufferForImageId,
} from '../src/dicom/imageId';
import {
  NotDicomError,
  extractInstanceSummary,
  hasDicomPreamble,
  parseDicomArrayBuffer,
} from '../src/dicom/parseDicom';
import { buildSyntheticDicom } from './helpers/syntheticDicom';

describe('parseDicomArrayBuffer：合成 DICOM 冒烟', () => {
  it('识别 DICM 魔数并返回预期 metadata', () => {
    const buffer = buildSyntheticDicom();
    expect(hasDicomPreamble(buffer)).toBe(true);

    const dataSet = parseDicomArrayBuffer(buffer);
    const summary = extractInstanceSummary(dataSet);

    expect(summary.patientName).toBe('M0^SMOKE^TEST');
    expect(summary.modality).toBe('CT');
    expect(summary.rows).toBe(16);
    expect(summary.columns).toBe(16);
    expect(summary.bitsAllocated).toBe(16);
    expect(summary.numberOfFrames).toBe(1);
    expect(summary.transferSyntaxUid).toBe('1.2.840.10008.1.2.1');
    expect(summary.sopInstanceUid).toContain('1.2.826.0.1.3680043');
  });

  it('自定义参数同样正确解析', () => {
    const dataSet = parseDicomArrayBuffer(
      buildSyntheticDicom({ patientName: 'WANG^XIAO^MING', modality: 'MR', rows: 32, columns: 24 }),
    );
    const summary = extractInstanceSummary(dataSet);
    expect(summary.patientName).toBe('WANG^XIAO^MING');
    expect(summary.modality).toBe('MR');
    expect(summary.rows).toBe(32);
    expect(summary.columns).toBe(24);
  });

  it('非 DICOM 文本文件抛出 NotDicomError', () => {
    const text = 'plain text file, definitely not a dicom file. '.repeat(4);
    const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
    expect(hasDicomPreamble(buffer)).toBe(false);
    expect(() => parseDicomArrayBuffer(buffer)).toThrow(NotDicomError);
  });

  it('截断的 DICOM 文件抛错而不是静默成功', () => {
    const full = new Uint8Array(buildSyntheticDicom());
    const truncated = full.slice(0, 150); // 有 DICM 魔数但数据集截断
    expect(() => parseDicomArrayBuffer(truncated)).toThrow();
  });
});

describe('dcm-file:// imageId 注册表', () => {
  it('生成的 imageId 使用自定义 scheme 且可取回原始 buffer', () => {
    const buffer = buildSyntheticDicom();
    const imageId = createDcmFileImageId(buffer);

    expect(imageId.startsWith(`${DCM_FILE_SCHEME}://`)).toBe(true);
    expect(getBufferForImageId(imageId)).toBe(buffer);
  });

  it('未登记或非本 scheme 的 imageId 取回时抛错', () => {
    expect(() => getBufferForImageId(`${DCM_FILE_SCHEME}://not-exist`)).toThrow();
    expect(() => getBufferForImageId('other-scheme://foo')).toThrow();
  });
});
