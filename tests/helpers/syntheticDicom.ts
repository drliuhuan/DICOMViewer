/**
 * 手工编码的最小合法 DICOM Part-10 文件（显式 VR 小端），
 * 用于无外部样本依赖的解析冒烟测试。
 */
export interface SyntheticDicomOptions {
  patientName?: string;
  modality?: string;
  rows?: number;
  columns?: number;
  /** 帧数；缺省/1 为单帧文件。>1 时写入 NumberOfFrames 并逐帧编码像素 */
  numberOfFrames?: number;
  seriesInstanceUid?: string;
  instanceNumber?: number;
  sliceLocation?: number;
  pixelSpacing?: [number, number];
  imageOrientationPatient?: [number, number, number, number, number, number];
  windowWidth?: number;
  windowCenter?: number;
}

/** 需要长格式长度字段（保留字节 + uint32 长度）的 VR */
const LONG_FORM_VRS = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN']);

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

function uint32Bytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

/** 编码 IS/DS 数值字符串（含多值反斜杠分隔） */
function numberStringBytes(values: number[]): Uint8Array {
  return padToEven(values.map((v) => String(v)).join('\\'), 0x20);
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
 * 128 字节 preamble + DICM + 文件元组（含组长度，dcmjs AsyncDicomReader 必需）
 * + 数据集 + 像素数据。
 *
 * 多帧（numberOfFrames > 1）时写入 (0028,0008) NumberOfFrames，
 * 且第 f 帧像素值整体偏移 `f × 帧像素数`（单帧保持原有渐变），便于断言帧内容差异。
 */
export function buildSyntheticDicom(options: SyntheticDicomOptions = {}): ArrayBuffer {
  const { patientName = 'M0^SMOKE^TEST', modality = 'CT', rows = 16, columns = 16 } = options;
  const numberOfFrames = Math.max(1, options.numberOfFrames ?? 1);

  const bytes: number[] = [];
  for (let i = 0; i < 128; i++) {
    bytes.push(0x00); // preamble
  }
  for (const ch of 'DICM') {
    bytes.push(ch.charCodeAt(0));
  }

  // ── File Meta Group (0002)：先编码到独立缓冲以计算组长度 ──
  const metaBytes: number[] = [];
  appendElement(metaBytes, 0x0002, 0x0010, 'UI', padToEven('1.2.840.10008.1.2.1', 0)); // Explicit VR Little Endian
  appendElement(bytes, 0x0002, 0x0000, 'UL', uint32Bytes(metaBytes.length)); // FileMetaInformationGroupLength
  bytes.push(...metaBytes);

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
  if (options.seriesInstanceUid !== undefined) {
    appendElement(bytes, 0x0020, 0x000e, 'UI', padToEven(options.seriesInstanceUid, 0));
  }
  if (options.instanceNumber !== undefined) {
    appendElement(bytes, 0x0020, 0x0013, 'IS', numberStringBytes([options.instanceNumber]));
  }
  if (options.sliceLocation !== undefined) {
    appendElement(bytes, 0x0020, 0x1041, 'DS', numberStringBytes([options.sliceLocation]));
  }
  if (options.imageOrientationPatient !== undefined) {
    appendElement(bytes, 0x0020, 0x0037, 'DS', numberStringBytes(options.imageOrientationPatient));
  }
  if (options.windowWidth !== undefined) {
    appendElement(bytes, 0x0028, 0x1051, 'DS', numberStringBytes([options.windowWidth]));
  }
  if (options.windowCenter !== undefined) {
    appendElement(bytes, 0x0028, 0x1050, 'DS', numberStringBytes([options.windowCenter]));
  }
  appendElement(bytes, 0x0010, 0x0010, 'PN', padToEven(patientName, 0x20)); // Patient Name
  appendElement(bytes, 0x0028, 0x0002, 'US', uint16Bytes(1)); // Samples per Pixel
  if (numberOfFrames > 1) {
    appendElement(bytes, 0x0028, 0x0008, 'IS', numberStringBytes([numberOfFrames])); // NumberOfFrames
  }
  if (options.pixelSpacing !== undefined) {
    appendElement(bytes, 0x0028, 0x0030, 'DS', numberStringBytes([...options.pixelSpacing]));
  }
  appendElement(bytes, 0x0028, 0x0010, 'US', uint16Bytes(rows)); // Rows
  appendElement(bytes, 0x0028, 0x0011, 'US', uint16Bytes(columns)); // Columns
  appendElement(bytes, 0x0028, 0x0100, 'US', uint16Bytes(16)); // Bits Allocated
  appendElement(bytes, 0x0028, 0x0103, 'US', uint16Bytes(0)); // Pixel Representation（无符号）

  // ── Pixel Data (7FE0,0010)：渐变灰度图，rows×columns×2 字节 × 帧数 ──
  // 第 f 帧（0 起始）像素值 = f × (rows×columns) + i，保证各帧灰度可区分
  const pixelCount = rows * columns;
  const pixelData = new Uint8Array(pixelCount * 2 * numberOfFrames);
  for (let frameIndex = 0; frameIndex < numberOfFrames; frameIndex++) {
    const frameOffset = frameIndex * pixelCount;
    for (let i = 0; i < pixelCount; i++) {
      const value = numberOfFrames > 1 ? frameOffset + i : i;
      const outOffset = (frameOffset + i) * 2;
      pixelData[outOffset] = value & 0xff;
      pixelData[outOffset + 1] = (value >> 8) & 0xff;
    }
  }
  appendElement(bytes, 0x7fe0, 0x0010, 'OW', pixelData);

  return new Uint8Array(bytes).buffer;
}
