/**
 * 序列来源登记（M11 任务 1）。
 *
 * 背景：`SeriesStack` 仅由「已打开的文件」构建（buildSeriesStacks）。
 * 用户以多选文件方式打开、打开中途取消、或 PACS 拉取部分失败时，
 * 序列在数据源层面即不完整 → MPR/3D 用不完整 imageId 集构建 volume
 * 会缺失层面/结构。本模块登记每批打开操作的「来源指纹」，供进入 MPR/3D
 * 时评估该序列能否从完整来源补齐：
 * - directory：File System Access 目录句柄可重扫（运行时持有句柄，不可持久化）；
 * - file-list：用户手动多选文件（无更多来源可枚举，视为已完整）；
 * - remote：PACS 远程检查，可按 SeriesUID 经 QIDO/WADO 核对并补拉缺失实例。
 *
 * 登记表为模块级 Map（与 dcm-file:// 缓冲注册表同一生命周期语义：
 * 随「清空全部」一并清空）。全部为纯结构 + 存取函数，Node 下单测安全。
 */
import type { DirectoryHandleLike } from '../loading/directoryScan';
import type { PacsServerConfig } from '../pacs/config';

/** 来源批次类型 */
export type SourceBatchKind = 'directory' | 'file-list' | 'remote';

/** 一批打开操作登记条目 */
export interface SourceBatch {
  id: string;
  kind: SourceBatchKind;
  /** 展示用标签（文件夹名 / 「手动选择文件」 / 服务器显示名） */
  label: string;
  /** 本批输入候选文件总数（remote 为拉取实例数下限的观测值） */
  scannedCount: number;
  /** 打开流程是否正常完成（未被取消；remote 批次恒 true，取消体现在 failedNames 前置） */
  completed: boolean;
  /** 打开失败的文件展示名列表（重扫目录时的核对线索之一） */
  failedNames: string[];
  /** 该批成功解析实例归属的序列 UID 集合（序列→批次归属判定依据） */
  knownSeriesUids: Set<string>;
  /** 已成功打开文件的 `${fileName}\u0000${fileSizeBytes}` 键集合（补载跳过依据） */
  openedFileKeys: Set<string>;
  /** directory 批次保留的重扫句柄（仅运行时；file-list/remote 为 undefined） */
  directoryHandle?: DirectoryHandleLike;
  /** remote 批次的拉取上下文快照 */
  remote?: {
    serverName: string;
    studyUid: string;
    /** 拉取时刻的服务器配置快照（后续编辑不影响补载使用的端点） */
    config: PacsServerConfig;
  };
}

const batches = new Map<string, SourceBatch>();

function makeBatchId(): string {
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 登记一批新打开操作。返回批次 id，供打开完成后调用 recordBatchOutcome。
 * @param descriptor 批次描述；directory 必须携带 handle 才能"主动补载"
 */
export function registerSourceBatch(descriptor: {
  kind: SourceBatchKind;
  label: string;
  scannedCount: number;
  directoryHandle?: DirectoryHandleLike;
  remote?: { serverName: string; studyUid: string; config: PacsServerConfig };
}): string {
  const id = makeBatchId();
  const batch: SourceBatch = {
    id,
    kind: descriptor.kind,
    label: descriptor.label,
    scannedCount: descriptor.scannedCount,
    completed: false,
    failedNames: [],
    knownSeriesUids: new Set(),
    openedFileKeys: new Set(),
  };
  if (descriptor.kind === 'directory') {
    batch.directoryHandle = descriptor.directoryHandle;
  }
  if (descriptor.kind === 'remote') {
    batch.remote = descriptor.remote;
  }
  batches.set(id, batch);
  return id;
}

/** 记录批次完成情况并把成功解析实例归属到该批（App 在 open/merge 后调用） */
export function recordBatchOutcome(
  batchId: string,
  outcome: {
    completed: boolean;
    failedNames?: readonly string[];
    /** 成功解析的实例（用于 openedFileKeys 与序列归属） */
    openedFiles?: ReadonlyArray<{ fileName: string; fileSizeBytes: number; seriesInstanceUid?: string }>;
  },
): void {
  const batch = batches.get(batchId);
  if (!batch) {
    return;
  }
  if (outcome.completed && !batch.completed) {
    batch.completed = true;
  }
  if (outcome.failedNames && outcome.failedNames.length > 0) {
    for (const name of outcome.failedNames) {
      if (!batch.failedNames.includes(name)) {
        batch.failedNames.push(name);
      }
    }
  }
  for (const file of outcome.openedFiles ?? []) {
    batch.openedFileKeys.add(`${file.fileName}\u0000${file.fileSizeBytes}`);
    if (file.seriesInstanceUid) {
      batch.knownSeriesUids.add(file.seriesInstanceUid);
    }
  }
}

/** 取批次（不存在返回 undefined） */
export function getSourceBatch(batchId: string): SourceBatch | undefined {
  return batches.get(batchId);
}

/** 全部批次（评估用，按登记顺序） */
export function listSourceBatches(): readonly SourceBatch[] {
  return [...batches.values()];
}

/** 清空登记（随「清空全部数据」调用；不释放任何缓冲区本身） */
export function clearSourceBatches(): void {
  batches.clear();
}

/** 测试隔离：重建登记表内容（覆盖既有 id） */
export function resetSourceBatchesForTest(seed?: readonly SourceBatch[]): void {
  batches.clear();
  for (const batch of seed ?? []) {
    batches.set(batch.id, batch);
  }
}
