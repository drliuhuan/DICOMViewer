/**
 * 文件加载入口（FR-1.1 多文件 / FR-1.4 非 DICOM 识别 / FR-1.5 坏文件容错）。
 *
 * - 逐个文件独立解析：单个坏文件不影响其他文件；
 *   失败按原因分类（not-dicom / parse-error），供错误报告列表汇总展示；
 * - 扩展名预筛（大小写不敏感）：命中常见非 DICOM 黑名单的文件不读取内容直接跳过，
 *   `.dcm`/`.dicom` 及无扩展名一律尝试解析；
 * - 文件内容登记进 `dcm-file://` 内存注册表并生成 imageId；
 * - 接受普通 File 或目录扫描得到的 {file, relativePath}（文件夹场景保留路径）。
 *
 * 解析进度反馈与取消在 M2-C 实现。
 */
import { createDcmFileImageId } from '../../dicom/imageId';
import { initializeDicomPipeline } from '../../dicom/init';
import {
  extractInstanceSummary,
  NotDicomError,
  ParseFailureError,
  parseDicomArrayBuffer,
  type DicomInstanceSummary,
} from '../../dicom/parseDicom';
import { isLikelyDicomFileName } from './dicomFileFilter';
import type { ScannedFile } from './directoryScan';

/** 已成功解析的单个 DICOM 实例（多帧文件 = 一条实例，含 numberOfFrames） */
export interface OpenedDicomFile {
  fileName: string;
  fileSizeBytes: number;
  /** base imageId（无 frame 查询参数）；多帧展开见 buildStacks */
  baseImageId: string;
  summary: DicomInstanceSummary;
}

/** 失败原因分类：非 DICOM 内容/类型（可预期跳过） vs 解析异常（坏文件） */
export type LoadFailureKind = 'not-dicom' | 'parse-error';

export interface LoadFailure {
  /** 展示用文件名（文件夹场景优先显示相对路径） */
  fileName: string;
  message: string;
  kind: LoadFailureKind;
}

export interface OpenFilesResult {
  opened: OpenedDicomFile[];
  failures: LoadFailure[];
}

/** 兼容两种输入：普通 File 或带相对路径的扫描结果 */
type OpenInput = ScannedFile | File;

function isScannedFile(input: OpenInput): input is ScannedFile {
  return 'file' in input && input.file instanceof File;
}

function normalizeInputs(inputs: readonly OpenInput[]): ScannedFile[] {
  return inputs.map((input) =>
    isScannedFile(input)
      ? input
      : { file: input, relativePath: input.name },
  );
}

async function openOne(scanned: ScannedFile): Promise<OpenedDicomFile> {
  const { file } = scanned;
  await initializeDicomPipeline();
  const buffer = await file.arrayBuffer();
  const dataSet = parseDicomArrayBuffer(buffer);
  const summary = extractInstanceSummary(dataSet);
  if (summary.rows <= 0 || summary.columns <= 0) {
    throw new NotDicomError(
      '不包含可显示的像素数据（可能是 SR 等非图像 DICOM 对象）',
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
 * 打开一批 DICOM 文件：预筛 → 读取 → 校验/解析 → 登记 imageId。
 *
 * 单个文件失败不会中断整批：
 * - 命中扩展名黑名单或缺少 DICM 魔数 → kind='not-dicom'（FR-1.4 可预期跳过）；
 * - 内容截断等解析异常 → kind='parse-error'（FR-1.5 坏文件）。
 */
export async function openDicomFiles(inputs: readonly OpenInput[]): Promise<OpenFilesResult> {
  const scanned = normalizeInputs(inputs);
  const opened: OpenedDicomFile[] = [];
  const failures: LoadFailure[] = [];
  for (const item of scanned) {
    const displayName =
      item.relativePath && item.relativePath !== item.file.name
        ? item.relativePath
        : item.file.name;
    try {
      // 扩展名预筛：明确排除常见非 DICOM 类型，避免无谓的字节读取（FR-1.4）
      if (!isLikelyDicomFileName(item.file.name)) {
        const ext = item.file.name.includes('.')
          ? item.file.name.slice(item.file.name.lastIndexOf('.') + 1)
          : '';
        failures.push({
          fileName: displayName,
          message: ext ? `非 DICOM 文件类型（.${ext.toLowerCase()}）` : '非 DICOM 文件类型',
          kind: 'not-dicom',
        });
        continue;
      }
      opened.push(await openOne(item));
    } catch (error) {
      console.error(`[openDicomFiles] 打开文件失败: ${displayName}`, error);
      // 有魔数但内容损坏（ParseFailureError）或其它异常 → 坏文件；缺魔数等 → 非 DICOM
      const isBadFile =
        error instanceof ParseFailureError || !(error instanceof NotDicomError);
      failures.push({
        fileName: displayName,
        message: error instanceof Error ? error.message : String(error),
        kind: isBadFile ? 'parse-error' : 'not-dicom',
      });
    }
  }
  return { opened, failures };
}
