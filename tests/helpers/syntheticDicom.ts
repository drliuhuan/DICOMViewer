/**
 * 手工编码的最小合法 DICOM Part-10 文件（显式 VR 小端），
 * 用于无外部样本依赖的解析冒烟测试。
 */
export interface SyntheticDicomOptions {
  patientName?: string;
  modality?: string;
  rows?: number;
  columns?: number;
}

/** 需要长格式长度字段（保留字节 + uint32 长度）的 VR */
const LONG_FORM_VRS = new Set([
  'OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN',
]);

function padToEven(value: string, padByte: number): Uint8Array {
  // 先按 UTF-8 编码，再对字节长度补齐（DICOM 值长度必须为偶数）
  const encoded = new TextEncoder().encode(value);
  if (encoded.length % 2 === 0) {
    return encoded;
  }
  const out = new Uint8Array(encoded.length + 1);
  out.set(encoded);
  out[encoded.length] = padByte;
  return out;
}

function uint16Bytes(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v, true));
  return out;
}

function appendElement(
  bytes: number[],
  group: number,
  element: number,
  vr: string,
  value: Uint8Array,
): void {
  if (value.length % 2 !== 0) {
    throw new Error(`元素 (${group.toString(16)},${element.toString(16)}) 值长度须为偶数`);
  }
  // Tag：小端（低字节在前）
  bytes.push(group & 0xff, (group >> 8) & 0xff, element & 0xff, (element >> 8) & 0xff);
  // VR：两个 ASCII 字符
  bytes.push(vr.charCodeAt(0), vr.charCodeAt(1));
  if (LONG_FORM_VRS.has(vr)) {
    bytes.push(0x00, 0x00); // 保留字节
    const length = value.length;
    bytes.push(length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff);
  } else {
    bytes.push(value.length & 0xff, (value.length >> 8) & 0xff);
  }
  for (const byte of value) {
    bytes.push(byte);
  }
}

/**
 * 构建最小合法的 CT Image Storage Part-10 文件：
 * 128 字节 preamble + DICM + 元组（传输语法）+ 数据集 + 像素数据。
 */
export function buildSyntheticDicom(options: SyntheticDicomOptions = {}): ArrayBuffer {
  const { patientName = 'M0^SMOKE^TEST', modality = 'CT', rows = 16, columns = 16 } =
    options;

  const bytes: number[] = [];
  for (let i = 0; i < 128; i++) {
    bytes.push(0x00); // preamble
  }
  for (const ch of 'DICM') {
    bytes.push(ch.charCodeAt(0));
  }

  // ── File Meta Group (0002) ──
  appendElement(bytes, 0x0002, 0x0010, 'UI', padToEven('1.2.840.10008.1.2.1', 0)); // Explicit VR Little Endian

  // ── Dataset（按 Tag 升序）──
  appendElement(bytes, 0x0008, 0x0016, 'UI', padToEven('1.2.840.10008.5.1.4.1.1.2', 0)); // SOP Class UID (CT)
  appendElement(
    bytes,
    0x0008,
    0x0018,
    'UI',
    padToEven('1.2.826.0.1.3680043.8.498.10002345987245', 0), // SOP Instance UID
  );
  appendElement(bytes, 0x0008, 0x0060, 'CS', padToEven(modality, 0x20)); // Modality
  appendElement(bytes, 0x0010, 0x0010, 'PN', padToEven(patientName, 0x20)); // Patient Name
  appendElement(bytes, 0x0028, 0x0002, 'US', uint16Bytes(1)); // Samples per Pixel
  appendElement(bytes, 0x0028, 0x0010, 'US', uint16Bytes(rows)); // Rows
  appendElement(bytes, 0x0028, 0x0011, 'US', uint16Bytes(columns)); // Columns
  appendElement(bytes, 0x0028, 0x0100, 'US', uint16Bytes(16)); // Bits Allocated
  appendElement(bytes, 0x0028, 0x0103, 'US', uint16Bytes(0)); // Pixel Representation（无符号）

  // ── Pixel Data (7FE0,0010)：渐变灰度图，rows×columns×2 字节 ──
  const pixelCount = rows * columns;
  const pixelData = new Uint8Array(pixelCount * 2);
  for (let i = 0; i < pixelCount; i++) {
    pixelData[2 * i] = i & 0xff;
    pixelData[2 * i + 1] = (i >> 8) & 0xff;
  }
  appendElement(bytes, 0x7fe0, 0x0010, 'OW', pixelData);

  return new Uint8Array(bytes).buffer;
}
