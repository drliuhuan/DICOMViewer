/**
 * 远程拉取实例 → 既有加载管线（FR-13.5/FR-13.6 P0）：
 * 拉回的 Part-10 字节与本地文件共用同一解析/登记路径
 * （parseDicomArrayBuffer → extractInstanceSummary → dcm-file:// 注册表），
 * 经 buildSeriesStacks 后与本地序列统一进入序列树，
 * 并携带 remoteSource 来源标记（服务器名 + 检查号）。
 *
 * TODO(FR-13.5, P1)：IndexedDB 缓存与 LRU 上限（当前内存驻留，受 NFR-4 约束）；
 * TODO(FR-13.5, P2)：会话级远程数据清理策略（当前随序列关闭/清空全部释放）。
 */
import { createDcmFileImageId } from '../../dicom/imageId';
import {
  extractInstanceSummary,
  NotDicomError,
  ParseFailureError,
  parseDicomArrayBuffer,
} from '../../dicom/parseDicom';
import type { LoadFailure, OpenedDicomFile } from '../loading/openDicomFiles';
import type { FetchedDicomInstance } from './dicomweb';

/** 远程来源标记（FR-13.5）：本地文件无此字段 */
export interface RemoteSource {
  /** 所属服务器（配置中的显示名） */
  serverName: string;
  /** 检查号（StudyInstanceUID） */
  studyUid: string;
}

export interface ToOpenedFilesResult {
  opened: OpenedDicomFile[];
  failures: LoadFailure[];
}

/**
 * 将拉回的实例字节转换为已打开文件（与本地打开同一结构）。
 * 单实例失败不中断整批：非图像对象 → not-dicom；损坏字节 → parse-error。
 */
export function toOpenedFiles(
  instances: readonly FetchedDicomInstance[],
  source: RemoteSource,
): ToOpenedFilesResult {
  const opened: OpenedDicomFile[] = [];
  const failures: LoadFailure[] = [];
  for (const instance of instances) {
    const fileName = `${instance.sopUid}.dcm`;
    try {
      const dataSet = parseDicomArrayBuffer(instance.buffer);
      const summary = extractInstanceSummary(dataSet);
      if (summary.rows <= 0 || summary.columns <= 0) {
        throw new NotDicomError('不包含可显示的像素数据（可能是 SR 等非图像 DICOM 对象）');
      }
      opened.push({
        fileName,
        fileSizeBytes: instance.buffer.byteLength,
        baseImageId: createDcmFileImageId(instance.buffer),
        summary,
        remoteSource: source,
      });
    } catch (error) {
      console.error(`[pacs] 解析远程实例失败: ${fileName}`, error);
      const isBadFile =
        error instanceof ParseFailureError || !(error instanceof NotDicomError);
      failures.push({
        fileName,
        message: error instanceof Error ? error.message : String(error),
        kind: isBadFile ? 'parse-error' : 'not-dicom',
      });
    }
  }
  return { opened, failures };
}
