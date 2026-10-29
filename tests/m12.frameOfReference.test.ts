/**
 * M12-F2：FrameOfReferenceUID 解析标签回归（FR-3.15 / FR-9.2）。
 *
 * 真实 PACS 中 StudyID（0020,0010）常缺失或各序列不一致；定位线匹配必须
 * 优先使用 FrameOfReferenceUID（0020,0052）。本用例用手工编码的最小
 * Part-10 文件覆盖：同 StudyID、不同 FoR → 解析结果不同；仅有 StudyID
 * 的旧数据 → 回退生效。
 */
import { describe, expect, it } from 'vitest';
import {
  extractInstanceSummary,
  parseDicomArrayBuffer,
} from '../src/dicom/parseDicom';

const LONG_FORM_VRS = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'UC',
  'UR',
  'UT',
  'UN',
]);

function padToEven(value: string, padByte: number): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length % 2 === 0) {
    return encoded;
  }
  const out = new Uint8Array(encoded.length + 1);
  out.set(encoded);
  out[encoded.length] = padByte;
  return out;
}

function uint16Bytes(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function uint32Bytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function appendElement(
  bytes: number[],
  group: number,
  element: number,
  vr: string,
  value: Uint8Array,
): void {
  bytes.push(group & 0xff, (group >> 8) & 0xff, element & 0xff, (element >> 8) & 0xff);
  bytes.push(vr.charCodeAt(0), vr.charCodeAt(1));
  if (LONG_FORM_VRS.has(vr)) {
    bytes.push(0x00, 0x00);
    const length = value.length;
    bytes.push(length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff);
  } else {
    bytes.push(value.length & 0xff, (value.length >> 8) & 0xff);
  }
  for (const byte of value) {
    bytes.push(byte);
  }
}

interface TagFixtureOptions {
  studyId?: string;
  frameOfReferenceUid?: string;
}

/** 构建最小合法 Part-10 文件：仅含本用例断言所需的标签。 */
function buildTaggedDicom(options: TagFixtureOptions): ArrayBuffer {
  const bytes: number[] = [];
  for (let i = 0; i < 128; i += 1) {
    bytes.push(0x00);
  }
  for (const ch of 'DICM') {
    bytes.push(ch.charCodeAt(0));
  }

  // File Meta：显式 VR 小端 + 组长度（dicom-parser 依此选择传输语法）
  const metaBytes: number[] = [];
  appendElement(
    metaBytes,
    0x0002,
    0x0010,
    'UI',
    padToEven('1.2.840.10008.1.2.1', 0),
  );
  appendElement(bytes, 0x0002, 0x0000, 'UL', uint32Bytes(metaBytes.length));
  bytes.push(...metaBytes);

  // Dataset（按 Tag 升序）
  appendElement(
    bytes,
    0x0008,
    0x0016,
    'UI',
    padToEven('1.2.840.10008.5.1.4.1.1.2', 0),
  ); // SOP Class UID
  appendElement(bytes, 0x0008, 0x0018, 'UI', padToEven('1.2.3.4.5.6', 0)); // SOP Instance UID
  if (options.studyId !== undefined) {
    appendElement(bytes, 0x0020, 0x0010, 'SH', padToEven(options.studyId, 0x20));
  }
  if (options.frameOfReferenceUid !== undefined) {
    appendElement(
      bytes,
      0x0020,
      0x0052,
      'UI',
      padToEven(options.frameOfReferenceUid, 0),
    );
  }
  appendElement(bytes, 0x0028, 0x0010, 'US', uint16Bytes(16)); // Rows
  appendElement(bytes, 0x0028, 0x0011, 'US', uint16Bytes(16)); // Columns
  appendElement(bytes, 0x7fe0, 0x0010, 'OW', new Uint8Array([0, 0])); // Pixel Data

  return new Uint8Array(bytes).buffer;
}

function parseTags(options: TagFixtureOptions) {
  return extractInstanceSummary(parseDicomArrayBuffer(buildTaggedDicom(options)));
}

describe('FrameOfReferenceUID 标签解析（0020,0052 优先）', () => {
  it('StudyID 相同但 FrameOfReferenceUID 不同 → 解析结果不同', () => {
    const firstDataSet = parseDicomArrayBuffer(
      buildTaggedDicom({
        studyId: 'STUDY-1',
        frameOfReferenceUid: '1.2.826.0.1.3680043.10.100',
      }),
    );
    const secondDataSet = parseDicomArrayBuffer(
      buildTaggedDicom({
        studyId: 'STUDY-1',
        frameOfReferenceUid: '1.2.826.0.1.3680043.10.200',
      }),
    );
    // 两份文件确实共享同一个 StudyID，排除「StudyID 不同导致差异」的误判
    expect(firstDataSet.string('x00200010')).toBe('STUDY-1');
    expect(secondDataSet.string('x00200010')).toBe('STUDY-1');

    const first = extractInstanceSummary(firstDataSet);
    const second = extractInstanceSummary(secondDataSet);
    expect(first.frameOfReferenceUid).toBe('1.2.826.0.1.3680043.10.100');
    expect(second.frameOfReferenceUid).toBe('1.2.826.0.1.3680043.10.200');
    expect(first.frameOfReferenceUid).not.toBe(second.frameOfReferenceUid);
  });

  it('仅有 StudyID（旧数据）→ 回退读取 0020,0010', () => {
    const summary = parseTags({ studyId: 'LEGACY-STUDY' });
    expect(summary.frameOfReferenceUid).toBe('LEGACY-STUDY');
  });

  it('FrameOfReferenceUID 为空/缺失时回退 StudyID', () => {
    expect(parseTags({ studyId: 'STUDY-2', frameOfReferenceUid: '' }).frameOfReferenceUid).toBe(
      'STUDY-2',
    );
    expect(parseTags({ frameOfReferenceUid: '1.2.3.4' }).frameOfReferenceUid).toBe('1.2.3.4');
  });
});
