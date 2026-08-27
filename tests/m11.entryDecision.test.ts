/**
 * M11 任务 1：序列选择器的候选判定（decideSeriesEntry）纯逻辑单测。
 */
import { describe, expect, it } from 'vitest';
import { decideSeriesEntry } from '../src/features/series/entryDecision';
import type { SeriesStack } from '../src/features/series/buildStacks';

function makeStack(
  seriesUid: string,
  frames: number,
  overrides: Partial<SeriesStack> = {},
): SeriesStack {
  return {
    seriesUid,
    modality: 'CT',
    description: `序列 ${seriesUid}`,
    items: Array.from({ length: frames }, (_, index) => ({
      imageId: `dcm-file://${seriesUid}-${index}`,
      fileName: `${seriesUid}-${index}.dcm`,
      frameNumber: index + 1,
      summary: {
        seriesInstanceUid: seriesUid,
        instanceNumber: index + 1,
      } as SeriesStack['items'][number]['summary'],
    })),
    patientId: 'P1',
    patientName: '张^三',
    studyInstanceUid: '1.2.study',
    studyDate: undefined,
    studyDescription: undefined,
    ...overrides,
  };
}

describe('decideSeriesEntry（MPR/3D 入口候选判定）', () => {
  const OK = { needsCheck: false };

  it('无任何序列 → error 并提示先加载数据', () => {
    const decision = decideSeriesEntry({
      stacks: [],
      preferredUid: null,
      assess: () => OK,
      targetLabel: 'MPR',
    });
    expect(decision.action).toBe('error');
    if (decision.action === 'error') {
      expect(decision.message).toContain('请先加载数据');
    }
  });

  it('单个已完整序列 → 直接 enter（跳过选择器）', () => {
    const stack = makeStack('1.2.a', 12);
    const decision = decideSeriesEntry({
      stacks: [stack],
      preferredUid: '1.2.a',
      assess: () => OK,
    });
    expect(decision.action).toBe('enter');
    if (decision.action === 'enter') {
      expect(decision.seriesUid).toBe('1.2.a');
    }
  });

  it('单个未核对完整性的序列 → 仍弹出选择器（兼作补载确认）', () => {
    const stack = makeStack('1.2.a', 4);
    const decision = decideSeriesEntry({
      stacks: [stack],
      preferredUid: '1.2.a',
      assess: () => ({ needsCheck: true, reason: '上次打开被取消' }),
    });
    expect(decision.action).toBe('pick');
    if (decision.action === 'pick') {
      expect(decision.candidates.length).toBe(1);
      expect(decision.candidates[0]?.needsCheck).toBe(true);
      expect(decision.candidates[0]?.preferred).toBe(true);
    }
  });

  it('≥2 个序列 → 弹出选择器并列全，激活序列标记 preferred', () => {
    const a = makeStack('1.2.a', 8);
    const b = makeStack('1.2.b', 30, {
      remoteSource: { serverName: '医院 PACS', studyUid: '1.2.study' },
    });
    const decision = decideSeriesEntry({
      stacks: [a, b],
      preferredUid: '1.2.b',
      assess: (stack) =>
        stack.remoteSource ? { needsCheck: true, reason: '远程未核对' } : OK,
    });
    expect(decision.action).toBe('pick');
    if (decision.action === 'pick') {
      expect(decision.candidates.map((row) => row.seriesUid)).toEqual(['1.2.a', '1.2.b']);
      const bRow = decision.candidates[1];
      expect(bRow?.preferred).toBe(true);
      expect(bRow?.originLabel).toBe('远程 · 医院 PACS');
      expect(bRow?.modality).toBe('CT');
      expect(bRow?.sliceCount).toBe(30);
      // 实例数按去重文件数统计（多帧不重复计数）
      expect(bRow?.instanceCount).toBe(30);
      expect(bRow?.needsCheckReason).toBe('远程未核对');
    }
  });

  it('候选行包含序列号与描述（选择器展示列）', () => {
    const stack = makeStack('1.2.c', 5, { description: '胸部 CT 平扫' });
    stack.items[0]!.summary.seriesNumber = 3;
    const other = makeStack('1.2.d', 9, { description: '骨窗' });
    const decision = decideSeriesEntry({
      stacks: [stack, other],
      preferredUid: '1.2.d',
      assess: () => OK,
    });
    expect(decision.action).toBe('pick');
    if (decision.action === 'pick') {
      expect(decision.candidates[0]?.seriesNumber).toBe(3);
      expect(decision.candidates[0]?.description).toBe('胸部 CT 平扫');
      // 无序列号的候选退回 UID 前缀展示（由 formatSeriesIdentifier 处理），此处验证原始值
      expect(decision.candidates[1]?.seriesNumber).toBeUndefined();
    } else {
      throw new Error(`unexpected action: ${decision.action}`);
    }
  });
});
