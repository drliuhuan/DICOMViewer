/**
 * 完整序列补载执行器（M11 任务 1）。
 *
 * 用户在序列选择器选定序列后，从该序列的「完整来源」把全部实例
 * （全部文件的全部帧）枚举/加载进来，再交给 App 并入既有管线
 * （dedupeBySopUid → buildSeriesStacks → volume 构建）。两条来源路径：
 *
 * - directory 重扫：File System Access 句柄重新枚举目录树，对
 *   「登记表 openedFileKeys 未覆盖」的候选文件逐个解析，仅把归属目标
 *   序列的文件注册进 dcm-file:// 注册表并返回；解析失败按 kind 分类记录，
 *   不中断整批（与 openDicomFiles 相同容错语义）。
 * - PACS 补拉：QIDO-RS 取该 SeriesUID 的完整实例列表（querySeriesInstances），
 *   与已打开 SOPInstanceUID 差集逐个 WADO-RS 拉取（retrieveInstanceBytes），
 *   经 toOpenedFiles 与本地打开共用同一解析/登记路径。
 *
 * 均支持进度回调与外部取消；全部网络/句柄依赖可注入（单测桩替换）。
 */
import { createDcmFileImageId } from '../../dicom/imageId';
import {
  extractInstanceSummary,
  NotDicomError,
  ParseFailureError,
  parseDicomArrayBuffer,
} from '../../dicom/parseDicom';
import { isLikelyDicomFileName } from '../loading/dicomFileFilter';
import { scanDirectoryHandle, type DirectoryHandleLike } from '../loading/directoryScan';
import type {
  LoadFailure,
  OpenedDicomFile,
} from '../loading/openDicomFiles';
import type { PacsServerConfig } from '../pacs/config';
import {
  DicomwebError,
  querySeriesInstances,
  retrieveInstanceBytes,
  type DicomwebFetch,
  type FetchedDicomInstance,
} from '../pacs/dicomweb';
import { toOpenedFiles } from '../pacs/remoteInstances';

/** 补载进度（done/total 为本轮核对的动作数） */
export interface FillProgress {
  done: number;
  total: number;
}

export interface FillOutcome {
  /** 新增的、归属目标序列且此前未打开过的实例 */
  added: OpenedDicomFile[];
  failures: LoadFailure[];
  /** 本轮核对的候选数（目录重扫=未打开候选文件数；PACS=远端报告实例总数） */
  checkedCount: number;
  cancelled: boolean;
}

export interface FillCommonOptions {
  targetSeriesUid: string;
  onProgress?: (progress: FillProgress) => void;
  signal?: AbortSignal;
}

export interface FillDirectoryOptions extends FillCommonOptions {
  directoryHandle: DirectoryHandleLike;
  /** 已打开文件的 `${fileName}\u0000${fileSizeBytes}` 键集合（跳过重复探测） */
  openedFileKeys?: ReadonlySet<string>;
}

/**
 * 目录重扫补齐（M11 任务 1 本地来源）：枚举目录 → 过滤未打开候选 →
 * 解析归属目标序列者并注册。非 DICOM 名称直接不计入核对总数。
 */
export async function fillFromDirectory(
  options: FillDirectoryOptions,
): Promise<FillOutcome> {
  const { directoryHandle, targetSeriesUid, onProgress, signal, openedFileKeys } = options;
  const scanned = await scanDirectoryHandle(directoryHandle);
  const candidates = scanned.filter((item) => {
    if (!isLikelyDicomFileName(item.file.name)) {
      return false;
    }
    const key = `${item.file.name}\u0000${item.file.size}`;
    return !openedFileKeys?.has(key);
  });
  const added: OpenedDicomFile[] = [];
  const failures: LoadFailure[] = [];
  let cancelled = false;
  const total = candidates.length;
  for (let index = 0; index < total; index++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const item = candidates[index];
    if (!item) {
      continue;
    }
    const displayName = item.relativePath ?? item.file.name;
    try {
      const buffer = await item.file.arrayBuffer();
      const dataSet = parseDicomArrayBuffer(buffer);
      const summary = extractInstanceSummary(dataSet);
      if (summary.rows <= 0 || summary.columns <= 0) {
        // 非图像对象：不算失败也不入栈（与主打开流程同语义）
      } else if (summary.seriesInstanceUid === targetSeriesUid) {
        added.push({
          fileName: item.file.name,
          fileSizeBytes: item.file.size,
          baseImageId: createDcmFileImageId(buffer),
          summary,
        });
      }
      // 其它序列的文件不吸收（该序列由其自身入口管理）
    } catch (error) {
      const isBadFile =
        error instanceof ParseFailureError || !(error instanceof NotDicomError);
      failures.push({
        fileName: displayName,
        message: error instanceof Error ? error.message : String(error),
        kind: isBadFile ? 'parse-error' : 'not-dicom',
      });
    }
    onProgress?.({ done: index + 1, total });
  }
  return { added, failures, checkedCount: total, cancelled };
}

export interface FillPacsOptions extends FillCommonOptions {
  context: NonNullable<import('./seriesCompleteness').RemoteFillContext>;
  /** 已打开实例的 SOPInstanceUID 集合（差集才拉取） */
  knownSopUids?: ReadonlySet<string>;
  fetchImpl?: DicomwebFetch;
}

/**
 * PACS 按 SeriesUID 补拉缺失实例（FR-13.5 通道复用，M11 任务 1 远程来源）。
 * QIDO 实例列表即"完整来源"权威口径；已存在的 SOP 不再重复拉取。
 */
export async function fillFromPacs(options: FillPacsOptions): Promise<FillOutcome> {
  const { context, targetSeriesUid, knownSopUids, onProgress, signal, fetchImpl } = options;
  const config: PacsServerConfig = context.config;
  const EMPTY: FillOutcome = {
    added: [],
    failures: [],
    checkedCount: 0,
    cancelled: true,
  };
  let sopUids: string[];
  try {
    sopUids = await querySeriesInstances(
      config,
      context.studyUid,
      context.seriesUid,
      fetchImpl,
      signal,
    );
  } catch (error) {
    // 用户在查询阶段取消：返回空结果（与 retrieveStudy 的取消语义一致）
    if (
      error instanceof DicomwebError ||
      (error instanceof Error && /取消|abort/i.test(error.message))
    ) {
      return EMPTY;
    }
    throw error;
  }
  const total = sopUids.length;
  const missing = sopUids.filter((sopUid) => !knownSopUids?.has(sopUid));
  const fetched: FetchedDicomInstance[] = [];
  let done = 0;
  let brokeEarly = false;
  for (const sopUid of missing) {
    if (signal?.aborted) {
      brokeEarly = true;
      break;
    }
    let abortedDuringRetrieve = false;
    try {
      const buffer = await retrieveInstanceBytes(
        config,
        context.studyUid,
        context.seriesUid,
        sopUid,
        fetchImpl,
        signal,
      );
      fetched.push({ seriesUid: targetSeriesUid, sopUid, buffer });
    } catch (error) {
      if (signal?.aborted) {
        abortedDuringRetrieve = true;
      } else {
        console.error(`[fillFromPacs] 拉取实例失败: ${sopUid}`, error);
      }
    }
    done += 1;
    onProgress?.({ done, total });
    if (abortedDuringRetrieve || signal?.aborted) {
      brokeEarly = true;
      break;
    }
  }
  const source = { serverName: context.serverName, studyUid: context.studyUid };
  const { opened, failures } = toOpenedFiles(fetched, source);
  return {
    added: opened,
    failures,
    checkedCount: total,
    cancelled: brokeEarly,
  };
}
