/**
 * 文件加载入口（FR-1.1 最小版：单文件）。
 * 文件夹递归加载、进度条、多文件与序列树在 M2 实现。
 */
import { createDcmFileImageId } from '../../dicom/imageId';
import { initializeDicomPipeline } from '../../dicom/init';
import {
  extractInstanceSummary,
  NotDicomError,
  parseDicomArrayBuffer,
  type DicomInstanceSummary,
} from '../../dicom/parseDicom';

export interface OpenedDicomFile {
  fileName: string;
  fileSizeBytes: number;
  imageId: string;
  summary: DicomInstanceSummary;
}

/**
 * 打开单个 DICOM 文件：读取 → 校验/解析 → 登记 imageId。
 *
 * @throws NotDicomError 非 DICOM 或不含可显示像素数据
 * @throws Error 渲染管线初始化失败
 */
export async function openDicomFile(file: File): Promise<OpenedDicomFile> {
  await initializeDicomPipeline();
  const buffer = await file.arrayBuffer();
  const dataSet = parseDicomArrayBuffer(buffer);
  const summary = extractInstanceSummary(dataSet);
  if (summary.rows <= 0 || summary.columns <= 0) {
    throw new NotDicomError(
      `"${file.name}" 不包含可显示的像素数据（可能是 SR 等非图像 DICOM 对象）`,
    );
  }
  return {
    fileName: file.name,
    fileSizeBytes: file.size,
    imageId: createDcmFileImageId(buffer),
    summary,
  };
}
