/**
 * MPR/3D 进入决策与序列候选（M11 任务 1，纯函数）。
 *
 * 需求：进入 MPR 或 3D 时，当存在多个候选序列，或当前序列未确认完整时，
 * 先弹序列选择器（列出序列号/描述/层数/模态/来源），用户选定后才进入；
 * 单序列且已完整加载时可跳过选择直接进入。
 *
 * 「完整性」判定由调用方注入（assess），本模块只做候选编排：
 * - 无任何序列 → error（含提示语）；
 * - ≥2 个序列 → pick（全部序列列出，激活视口锁定序列标记 preferred）；
 * - 1 个序列且 needsCheck → pick（唯一候选项兼作「进入前补载确认」）；
 * - 1 个序列已完整 → enter 直接进入。
 */
import type { SeriesStack } from './buildStacks';

/** 单个候选序列在选择器中的展示行 */
export interface SeriesCandidateRow {
  seriesUid: string;
  /** 序列号（0020,0011）；缺失退回 undefined 由 UI 显示 UID 前缀 */
  seriesNumber: number | undefined;
  description: string | undefined;
  modality: string;
  /** 层数 = 多帧展开后的总帧数（items.length，与 volume imageIds 一致） */
  sliceCount: number;
  /** 实例数 = 去重文件数 */
  instanceCount: number;
  patientName: string;
  studyDescription: string | undefined;
  originLabel: string;
  needsCheck: boolean;
  needsCheckReason?: string;
  /** 是否为当前激活视口锁定的序列（默认选中项） */
  preferred: boolean;
}

export type SeriesEntryDecision =
  | { action: 'error'; message: string }
  | { action: 'enter'; seriesUid: string }
  | { action: 'pick'; candidates: readonly SeriesCandidateRow[] };

export interface CompletenessAssessment {
  needsCheck: boolean;
  reason?: string;
}

export interface DecideEntryArgs {
  stacks: readonly SeriesStack[];
  /** 当前激活视口锁定的序列 uid；可为 null（无加载） */
  preferredUid: string | null;
  /** 序列完整性评估注入（App 用 sourceRegistry 实现） */
  assess: (stack: SeriesStack) => CompletenessAssessment;
  /** 目标入口名（提示语用） */
  targetLabel?: string;
}

function candidateFrom(
  stack: SeriesStack,
  assessment: CompletenessAssessment,
  preferredUid: string | null,
): SeriesCandidateRow {
  const files = new Set(stack.items.map((item) => item.fileName));
  return {
    seriesUid: stack.seriesUid,
    seriesNumber: stack.items[0]?.summary.seriesNumber,
    description:
      stack.description ?? stack.studyDescription ?? undefined,
    modality: stack.modality,
    sliceCount: stack.items.length,
    instanceCount: files.size,
    patientName: stack.patientName,
    studyDescription: stack.studyDescription,
    originLabel: originLabelOf(stack),
    needsCheck: assessment.needsCheck,
    needsCheckReason: assessment.reason,
    preferred: stack.seriesUid === preferredUid,
  };
}

/** 序列来源展示标签（本地文件夹/手动文件/远程） */
export function originLabelOf(stack: SeriesStack): string {
  if (stack.remoteSource) {
    return `远程 · ${stack.remoteSource.serverName}`;
  }
  return '本地';
}

/**
 * MPR/3D 入口决策（FR-6.9/FR-7.1 入口前置的序列选择，M11 任务 1）。
 */
export function decideSeriesEntry(args: DecideEntryArgs): SeriesEntryDecision {
  const { stacks, preferredUid, assess } = args;
  const label = args.targetLabel ?? '重建';
  if (stacks.length === 0) {
    return { action: 'error', message: `请先加载数据后再进入${label}` };
  }
  const candidates = stacks.map((stack) =>
    candidateFrom(stack, assess(stack), preferredUid),
  );
  if (candidates.length >= 2) {
    return { action: 'pick', candidates };
  }
  const single = candidates[0];
  if (!single) {
    return { action: 'error', message: `请先加载数据后再进入${label}` };
  }
  // 唯一候选未核对完整性 → 仍走选择器（唯一项即"确认并自动补载"，可取消）
  if (single.needsCheck) {
    return { action: 'pick', candidates };
  }
  return { action: 'enter', seriesUid: single.seriesUid };
}
