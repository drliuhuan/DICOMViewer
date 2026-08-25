/**
 * M2-F 序列树形导航面板测试（FR-2.1/2.2/2.7）：
 * 患者→检查→序列层级渲染、卡片信息补全、点击加载、激活态。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SeriesPanel } from '../src/ui/components/SeriesPanel';
import { SERIES_UID_MIME } from '../src/features/viewer/seriesDragDrop';
import { buildSeriesStacks } from '../src/features/series/buildStacks';
import { buildSeriesTree } from '../src/features/series/seriesTree';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

function makeOpened(overrides: {
  seriesUid: string;
  patientId?: string;
  patientName?: string;
  studyInstanceUid?: string;
  studyDate?: string;
  studyDescription?: string;
  seriesDescription?: string;
}): OpenedDicomFile {
  return {
    fileName: `${overrides.seriesUid}.dcm`,
    fileSizeBytes: 1024,
    baseImageId: `dcm-file://${overrides.seriesUid}`,
    summary: {
      patientName: overrides.patientName ?? '张^三',
      patientId: overrides.patientId,
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: overrides.studyInstanceUid,
      studyDate: overrides.studyDate,
      studyDescription: overrides.studyDescription,
      institutionName: undefined,
      seriesInstanceUid: overrides.seriesUid,
      seriesNumber: undefined,
      seriesDescription: overrides.seriesDescription,
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

function renderPanel(
  opened: OpenedDicomFile[],
  props: Partial<Parameters<typeof SeriesPanel>[0]> = {},
) {
  const onLoadSeries = vi.fn();
  const patients = buildSeriesTree(buildSeriesStacks(opened));
  const view = render(
    <SeriesPanel
      patients={patients}
      activeUid={props.activeUid ?? null}
      onLoadSeries={onLoadSeries}
      thumbnails={props.thumbnails}
    />,
  );
  return { ...view, onLoadSeries };
}

describe('SeriesPanel（患者→检查→序列树）', () => {
  afterEach(() => cleanup());

  it('渲染患者与检查层级；同一患者的多次检查并列', () => {
    const { container } = renderPanel([
      makeOpened({
        seriesUid: '1.2.a',
        patientId: 'P001',
        studyInstanceUid: 'S1',
        studyDate: '20260301',
        studyDescription: '胸部CT平扫',
        seriesDescription: '肺窗',
      }),
      makeOpened({
        seriesUid: '1.2.b',
        patientId: 'P001',
        studyInstanceUid: 'S2',
        studyDate: '20260101',
        studyDescription: '头颅MR',
        seriesDescription: 'T2',
      }),
      makeOpened({ seriesUid: '1.2.c', patientId: 'P002', patientName: '李^四' }),
    ]);
    const patients = Array.from(container.querySelectorAll('.tree-patient-header'));
    expect(patients).toHaveLength(2);
    const zhang = patients.find((el) => el.textContent?.includes('张^三'))!;
    expect(zhang.textContent).toContain('P001');
    // 检查标题：描述 + 格式化日期（YYYYMMDD → YYYY-MM-DD），同一患者两次检查并列
    const zhangSection = zhang.closest('.tree-patient')!;
    const studies = Array.from(zhangSection.querySelectorAll('.tree-study-header'));
    expect(studies).toHaveLength(2);
    expect(studies[0]?.textContent).toContain('胸部CT平扫');
    expect(studies[0]?.textContent).toContain('2026-03-01');
    expect(studies[1]?.textContent).toContain('头颅MR');
  });

  it('序列卡片信息补全：模态/描述/层数/矩阵/像素间距/层厚（FR-2.2）', () => {
    const { container } = renderPanel([
      makeOpened({ seriesUid: '1.2.a', seriesDescription: '肺窗' }),
    ]);
    const card = container.querySelector('.series-item')!;
    expect(card.querySelector('.series-item-modality')?.textContent).toBe('CT');
    expect(card.querySelector('.series-item-label')?.textContent).toContain('肺窗');
    const meta = card.querySelector('.series-item-meta')?.textContent ?? '';
    expect(meta).toContain('1 层');
    expect(meta).toContain('512×512');
    expect(meta).toContain('0.5×0.48mm');
    expect(meta).toContain('层厚 1.25mm');
  });

  it('点击卡片回调对应序列 uid；activeUid 命中时加激活态', () => {
    const { container, onLoadSeries } = renderPanel(
      [makeOpened({ seriesUid: '1.2.a' }), makeOpened({ seriesUid: '1.2.b' })],
      { activeUid: '1.2.b' },
    );
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('.series-item'));
    fireEvent.click(cards[0]!);
    expect(onLoadSeries).toHaveBeenCalledWith('1.2.a');
    expect(cards[1]?.classList.contains('series-item--active')).toBe(true);
    expect(cards[0]?.classList.contains('series-item--active')).toBe(false);
  });

  it('拖拽卡片写入自定义 MIME（视口放置目标识别依据）', () => {
    const { container, onLoadSeries } = renderPanel([makeOpened({ seriesUid: '1.2.a' })]);
    const card = container.querySelector('.series-item')!;
    const setData = vi.fn();
    fireEvent.dragStart(card, {
      dataTransfer: { setData, effectAllowed: null },
    });
    expect(setData).toHaveBeenCalledWith(SERIES_UID_MIME, '1.2.a');
    expect(onLoadSeries).not.toHaveBeenCalled();
  });

  it('提供缩略图时渲染 img，未提供时显示占位图标（M2-H 槽位）', () => {
    const { container, rerender } = render(
      <SeriesPanel
        patients={buildSeriesTree(buildSeriesStacks([makeOpened({ seriesUid: '1.2.a' })]))}
        activeUid={null}
        onLoadSeries={() => {}}
      />,
    );
    expect(container.querySelector('.series-thumb-placeholder')).not.toBeNull();

    rerender(
      <SeriesPanel
        patients={buildSeriesTree(buildSeriesStacks([makeOpened({ seriesUid: '1.2.a' })]))}
        activeUid={null}
        onLoadSeries={() => {}}
        thumbnails={{ '1.2.a': 'data:image/png;base64,xyz' }}
      />,
    );
    const img = container.querySelector('.series-thumb img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,xyz');
  });
});
