/**
 * 文件加载入口（FR-1.1 多文件版）。
 *
 * - 逐个文件独立解析：单个坏文件不影响其他文件（FR-1.5 的 M1 最小版）；
 * - 文件内容登记进 `dcm-file://` 内存注册表并生成 imageId；
 * - 多帧文件在此阶段仍为单条实例，由 buildStacks 按帧数展开。
 *
 * 文件夹递归加载、进度条与完整错误报告列表在 M2 实现。
 */
import { createDcmFileImageId } from '../../dicom/imageId';
import { initializeDicomPipeline } from '../../dicom/init';
import {
  extractInstanceSummary,
  NotDicomError,
  parseDicomArrayBuffer,
  type DicomInstanceSummary,
} from '../../dicom/parseDicom';

/** 已成功解析的单个 DICOM 实例（多帧文件 = 一条实例，含 numberOfFrames） */
export interface OpenedDicomFile {
  fileName: string;
  fileSizeBytes: number;
  /** base imageId（无 frame 查询参数）；多帧展开见 buildStacks */
  baseImageId: string;
  summary: DicomInstanceSummary;
}

export interface LoadFailure {
  fileName: string;
  message: string;
}

export interface OpenFilesResult {
  opened: OpenedDicomFile[];
  failures: LoadFailure[];
}

async function openOne(file: File): Promise<OpenedDicomFile> {
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
    baseImageId: createDcmFileImageId(buffer),
    summary,
  };
}

/**
 * 打开一批 DICOM 文件：读取 → 校验/解析 → 登记 imageId。
 * 单个文件失败不会中断整批；失败原因汇总在 `failures`。
 */
export async function openDicomFiles(files: File[]): Promise<OpenFilesResult> {
  const opened: OpenedDicomFile[] = [];
  const failures: LoadFailure[] = [];
  for (const file of files) {
    try {
      opened.push(await openOne(file));
    } catch (error) {
      console.error(`[openDicomFiles] 打开文件失败: ${file.name}`, error);
      failures.push({
        fileName: file.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { opened, failures };
}
