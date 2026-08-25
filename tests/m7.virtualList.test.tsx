/**
 * M7 序列列表虚拟化测试（NFR-1/NFR-2，FR-2.1 性能）：
 * - 单检查序列数 ≥ VIRTUALIZE_MIN_SERIES 时窗口化渲染（仅可视区 ± 超扫）；
 * - 虚拟卡片绝对定位（top = index × 行高），data-index 与序列顺序一一对应；
 * - 滚动后窗口随 scrollTop 平移；滚出该检查区域时不渲染其卡片；
 * - 多检查时各检查卡片区偏移独立计算；
 * - 小列表（< 阈值）保持原流式 DOM（无 .series-virtual / 无绝对定位），存量行为不变。
 *
 * jsdom 无布局：可视高度取组件内 FALLBACK_VIEWPORT_HEIGHT=600；
 * scrollTop 通过 defineProperty 注入后派发 scroll 事件驱动窗口更新。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  SERIES_ROW_HEIGHT,
  SeriesPanel,
  VIRTUALIZE_MIN_SERIES,
} from '../src/ui/components/SeriesPanel';
import { buildSeriesStacks } from '../src/features/series/buildStacks';
import { buildSeriesTree, type PatientNode } from '../src/features/series/seriesTree';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

/** 患者头部 + 检查头部的固定高度（与 SeriesPanel 内部常量一致） */
const PATIENT_HEADER_HEIGHT = 30;
const STUDY_HEADER_HEIGHT = 26;

function makeOpened(seriesIndex: number, studyUid: string, patientId: string): OpenedDicomFile {
  const seriesUid = `${studyUid}-series-${seriesIndex}`;
  return {
    fileName: `${seriesUid}.dcm`,
    fileSizeBytes: 1024,
    baseImageId: `dcm-file://${seriesUid}`,
    summary: {
      patientName: `患者${patientId}`,
      patientId,
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: studyUid,
      studyDate: '20240101',
      studyDescription: `检查 ${studyUid}`,
      institutionName: undefined,
      seriesInstanceUid: seriesUid,
      seriesNumber: undefined,
      seriesDescription: `序列 ${seriesIndex}`,
      instanceNumber: undefined,
      sliceLocation: undefined,
      sliceThickness: 1.25,
      pixelSpacing: [0.5, 0.48],
      imagePositionPatient: undefined,
      imageOrientationPatient: undefined,
      perFrameImagePositions: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 512,
      columns: 512,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: undefined,
      sopInstanceUid: undefined,
      transferSyntaxUid: undefined,
    },
  };
}

/** 按 [检查UID, 序列数] 列表构造患者树（序列按 UID 字典序，与 buildSeriesTree 排序一致） */
function makePatients(
  counts: ReadonlyArray<readonly [studyUid: string, seriesCount: number]>,
  patientId = 'P1',
): PatientNode[] {
  const opened = counts.flatMap(([studyUid, seriesCount]) =>
    Array.from({ length: seriesCount }, (_, i) => makeOpened(i, studyUid, patientId)),
  );
  return buildSeriesTree(buildSeriesStacks(opened));
}

function renderPanel(patients: PatientNode[], props: Partial<Parameters<typeof SeriesPanel>[0]> = {}) {
  const onLoadSeries = vi.fn();
  const view = render(
    <SeriesPanel
      patients={patients}
      activeUid={props.activeUid ?? null}
      onLoadSeries={onLoadSeries}
      onCloseSeries={props.onCloseSeries}
    />,
  );
  const list = view.container.querySelector('.series-panel-list') as HTMLElement;
  return { ...view, list, onLoadSeries };
}

function setScrollTop(list: HTMLElement, value: number): void {
  Object.defineProperty(list, 'scrollTop', { configurable: true, value });
  fireEvent.scroll(list);
}

function queryCards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.series-item')) as HTMLElement[];
}

describe('SeriesPanel 虚拟化（大序列窗口化）', () => {
  afterEach(() => cleanup());

  it('单检查 60 序列：仅渲染可视窗口内的卡片，虚拟容器总高 = 序列数 × 行高', () => {
    const { container } = renderPanel(makePatients([['S1', 60]]));
    const cards = queryCards(container);
    // 窗口：localTop=-56 → first=0；localBottom=544 → last=ceil(544/64)+6=15 → 16 张
    expect(cards.length).toBe(16);
    expect(cards.length).toBeLessThan(60);
    const virtualBox = container.querySelector<HTMLElement>('.series-virtual');
    expect(virtualBox).not.toBeNull();
    expect(virtualBox!.style.height).toBe(`${60 * SERIES_ROW_HEIGHT}px`);
    const first = cards[0]!;
    expect(first.classList.contains('series-item--virtual')).toBe(true);
    expect(first.dataset.index).toBe('0');
    expect(first.style.top).toBe('0px');
  });

  it('虚拟卡片点击加载对应顺序的序列', () => {
    const { container, onLoadSeries } = renderPanel(makePatients([['S1', 60]]));
    const cards = queryCards(container);
    const fifth = cards[4]!;
    expect(fifth.dataset.index).toBe('4');
    expect(fifth.style.top).toBe(`${4 * SERIES_ROW_HEIGHT}px`);
    fireEvent.click(fifth);
    // 序列按 UID 字典序：0,1,10,11,12,…（两位数排在个位之后），第 5 个（下标 4）为 series-12
    expect(onLoadSeries).toHaveBeenCalledWith('S1-series-12');
  });

  it('滚动后窗口随 scrollTop 平移（data-index 与定位同步更新）', () => {
    const { container, list } = renderPanel(makePatients([['S1', 60]]));
    setScrollTop(list, 2000);
    const cards = queryCards(container);
    // cardTop=56；localTop=1944 → first=floor(1944/64)-6=24；
    // localBottom=2544 → last=min(59, ceil(2544/64)+6)=46 → 23 张
    expect(cards.length).toBe(23);
    const first = cards[0]!;
    expect(first.dataset.index).toBe('24');
    expect(first.style.top).toBe(`${24 * SERIES_ROW_HEIGHT}px`);
    const last = cards[cards.length - 1]!;
    expect(last.dataset.index).toBe('46');
  });

  it('完全滚出该检查区域 → 不渲染其序列卡片', () => {
    const { container, list } = renderPanel(makePatients([['S1', 60]]));
    setScrollTop(list, 4000);
    // localTop=3944 > 总高 3840 → 窗口为空
    expect(queryCards(container).length).toBe(0);
  });

  it('多检查：后一检查的窗口独立计算，前一检查滚出后不再渲染', () => {
    const { container, list, onLoadSeries } = renderPanel(
      makePatients([
        ['S1', 30],
        ['S2', 30],
      ]),
    );
    // 初始：S1 cardTop=56 可见（16 张）；S2 cardTop=2002 在视口外 → 0 张
    expect(queryCards(container).length).toBe(16);
    expect(queryCards(container)[0]!.dataset.index).toBe('0');

    setScrollTop(list, PATIENT_HEADER_HEIGHT + 30 * SERIES_ROW_HEIGHT + STUDY_HEADER_HEIGHT);
    const cards = queryCards(container);
    expect(cards.length).toBeGreaterThan(0);
    // S1 完全滚出（localTop=1946 > 1920），S2 从自身第 0 张开始渲染
    expect(cards[0]!.dataset.index).toBe('0');
    fireEvent.click(cards[0]!);
    expect(onLoadSeries).toHaveBeenCalledWith('S2-series-0');
  });

  it('小列表（< 阈值）保持流式 DOM：全部渲染、无虚拟容器、无绝对定位', () => {
    const { container } = renderPanel(makePatients([['S1', 3]]));
    const cards = queryCards(container);
    expect(cards.length).toBe(3);
    expect(container.querySelector('.series-virtual')).toBeNull();
    expect(container.querySelector('.series-item--virtual')).toBeNull();
    expect(cards[0]!.style.top).toBe('');
  });

  it('阈值边界：VIRTUALIZE_MIN_SERIES-1 流式，VIRTUALIZE_MIN_SERIES 起窗口化', () => {
    const below = renderPanel(makePatients([['S1', VIRTUALIZE_MIN_SERIES - 1]]));
    expect(below.container.querySelector('.series-virtual')).toBeNull();
    expect(queryCards(below.container).length).toBe(VIRTUALIZE_MIN_SERIES - 1);

    const at = renderPanel(makePatients([['S1', VIRTUALIZE_MIN_SERIES]]));
    expect(at.container.querySelector('.series-virtual')).not.toBeNull();
    expect(queryCards(at.container).length).toBeLessThan(VIRTUALIZE_MIN_SERIES);
  });
});
