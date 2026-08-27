/**
 * 序列完整性评估与补载来源解析（M11 任务 1）。
 *
 * - 评估：给定序列堆栈 + 来源登记表 → 该序列能否从「完整来源」补齐、
 *   以及需要哪种补载方式（directory 重扫 / PACS 按 SeriesUID 补拉）。
 *   远程序列一律视为未核对（实例总数只有在 QIDO 核对后才知道）；
 *   本地 directory 批次发生过取消或存在失败文件时视为可能不完整；
 *   手动多选文件（file-list）无更多可枚举来源，视为已完整。
 * - 解析：序列 → 具体补载执行上下文（目录句柄 / 服务器配置快照 + 检查号）。
 *
 * 纯函数（登记表经参数注入），Node 下单测安全。
 */
import type { PacsServerConfig } from '../pacs/config';
import type { SeriesStack } from './buildStacks';
import { listSourceBatches, type SourceBatch } from './sourceRegistry';

/** 补载执行方式 */
export type FillKind = 'none' | 'directory' | 'pacs';

/** PACS 按 SeriesUID 补拉缺失实例的执行上下文 */
export interface RemoteFillContext {
  serverName: string;
  studyUid: string;
  seriesUid: string;
  /** 补载使用的服务器配置（拉取时刻快照或当前默认配置） */
  config: PacsServerConfig;
}

export interface SeriesCompletenessInfo {
  /** 是否需要在进入前核对并补载 */
  needsCheck: boolean;
  /** 未核对原因（中文，选择器展示） */
  reason?: string;
  /** 补载执行方式 */
  fillKind: FillKind;
  /** directory 补载：来源批次 id */
  batchId?: string;
  /** pacs 补载上下文（resolveRemoteContext 解析后填充） */
  remote?: RemoteFillContext;
}

/**
 * 评估单个序列的完整性与补载方式。
 * @param stack 目标序列堆栈
 */
export function assessSeriesCompleteness(stack: SeriesStack): SeriesCompletenessInfo {
  // 远程序列：实例完整性未核对（QIDO 分页上限/逐实例失败都可能造成缺层）
  if (stack.remoteSource) {
    return {
      needsCheck: true,
      reason: `远程序列（${stack.remoteSource.serverName}）尚未核对完整实例列表，进入时将自动补拉缺失实例`,
      fillKind: 'pacs',
    };
  }

  // 本地：找登记过该序列的批次；优先 directory（可重扫），其次 file-list
  const owning = listSourceBatches().filter((batch) =>
    batch.knownSeriesUids.has(stack.seriesUid),
  );
  const directory = owning.find((batch) => batch.kind === 'directory');
  if (directory) {
    return assessDirectoryBatch(directory);
  }
  if (owning.some((batch) => batch.kind === 'remote')) {
    return {
      needsCheck: true,
      reason: '该序列含远程来源实例，进入时将自动核对是否还有缺失实例',
      fillKind: 'pacs',
    };
  }
  // 仅手动多选文件（或历史无登记）：无更多可枚举来源，视为已打开即全部
  return { needsCheck: false, fillKind: 'none' };
}

function assessDirectoryBatch(batch: SourceBatch): SeriesCompletenessInfo {
  if (!batch.completed) {
    return {
      needsCheck: true,
      reason: `上次打开「${batch.label}」被取消，可能缺少后续文件；将重扫目录补齐`,
      fillKind: 'directory',
      batchId: batch.id,
    };
  }
  if (batch.failedNames.length > 0) {
    const hint = batch.failedNames[0] ? `（如 ${batch.failedNames[0]}）` : '';
    return {
      needsCheck: true,
      reason: `上次打开「${batch.label}」存在 ${batch.failedNames.length} 个失败文件${hint}；将重扫目录核对该序列其余文件`,
      fillKind: 'directory',
      batchId: batch.id,
    };
  }
  // 干净完成的整目录扫描：目录内同序列文件已全部入栈，无需重扫
  return { needsCheck: false, fillKind: 'none' };
}

/**
 * 解析 pacs 补载的具体服务器配置：
 * 序列仅携带 serverName + studyUid（remoteInstances 标记），此处按名称匹配
 * 当前 PACS 服务器列表；匹配不到时回退默认/首个配置；完全无配置返回 error。
 */
export function resolveRemoteContext(
  info: SeriesCompletenessInfo,
  stack: SeriesStack,
  servers: readonly PacsServerConfig[],
): SeriesCompletenessInfo & { error?: string } {
  if (info.fillKind !== 'pacs') {
    return info;
  }
  const want = stack.remoteSource?.serverName;
  const config =
    servers.find((server) => server.name === want) ??
    servers.find((server) => server.isDefault) ??
    servers[0];
  const studyUid = stack.remoteSource?.studyUid ?? stack.studyInstanceUid;
  if (!config || !studyUid) {
    return {
      ...info,
      error: '无法确定远程序列的服务器配置，请先在 PACS 面板重新拉取该检查',
    };
  }
  return {
    ...info,
    remote: {
      serverName: config.name,
      studyUid,
      seriesUid: stack.seriesUid,
      config,
    },
  };
}
