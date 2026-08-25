/**
 * M1 验收缺陷回归：序列面板拖拽序列到指定视口。
 *
 * - 序列卡片 draggable=true，dragstart 以自定义 MIME
 *   （application/x-series-uid）携带 seriesUid；
 * - 视口单元格作为放置目标：dragover preventDefault + 悬停高亮，
 *   drop 读取 seriesUid → 加载到「该」视口（而非激活视口）；
 * - 与全窗口拖拽打开外部文件逻辑（dragDepthRef）互不干扰：
 *   内部序列拖拽不触发 app--drag-active / 文件打开 overlay。
 *
 * 点击行为不变：点击 = 加载到当前激活视口。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import {
  SERIES_UID_MIME,
  isSeriesDragEvent,
  readSeriesUidFromDataTransfer,
} from '../src/features/viewer/seriesDragDrop';
import type { OpenedDicomFile } from '../src/features/loading/openDicomFiles';

const { getRenderingEngineMock } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'cornerstonestackviewportscroll',
      VOI_MODIFIED: 'cornerstonevoimodified',
      CAMERA_MODIFIED: 'cornerstonecameramodified',
    },
  },
  RenderingEngine: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  cache: {},
  utilities: { scroll: vi.fn(), transformWorldToIndex: vi.fn() },
  getRenderingEngine: getRenderingEngineMock,
}));

vi.mock('../src/dicom/init', () => ({
  initializeDicomPipeline: vi.fn(async () => undefined),
}));

vi.mock('../src/features/viewer/toolSetup', () => ({
  ToolNames: {
    windowLevel: 'WindowLevel',
    zoom: 'Zoom',
    pan: 'Pan',
    stackScroll: 'StackScroll',
    length: 'Length',
    angle: 'Angle',
    rectangleRoi: 'RectangleROI',
    ellipticalRoi: 'EllipticalROI',
    probe: 'Probe',
  },
  PLACEHOLDER_MEASUREMENT_TOOLS: ['Length', 'Angle', 'RectangleROI', 'EllipticalROI', 'Probe'],
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: vi.fn(() => ({ id: 'fake-tool-group' })),
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

const openDicomFilesMock = vi.hoisted(() => vi.fn());

vi.mock('../src/features/loading/openDicomFiles', () => ({
  openDicomFiles: openDicomFilesMock,
}));

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

function makeOpened(seriesUid: string, baseImageId: string): OpenedDicomFile {
  return {
    fileName: `${seriesUid}.dcm`,
    fileSizeBytes: 128,
    baseImageId,
    summary: {
      patientName: '',
      patientId: undefined,
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: undefined,
      studyDate: undefined,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: seriesUid,
      seriesNumber: 1,
      seriesDescription: undefined,
      instanceNumber: 1,
      sliceLocation: undefined,
      sliceThickness: undefined,
      pixelSpacing: undefined,
      imagePositionPatient: undefined,
      imageOrientationPatient: undefined,
      perFrameImagePositions: undefined,
      windowWidth: undefined,
      windowCenter: undefined,
      rows: 8,
      columns: 8,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: undefined,
      sopInstanceUid: undefined,
      transferSyntaxUid: undefined,
    },
  };
}

/** 构造 dataTransfer 测试替身 */
function makeDataTransfer(options: {
  types?: string[];
  uid?: string;
  files?: File[];
} = {}): DataTransfer {
  const stored = new Map<string, string>();
  return {
    types: options.types ?? [],
    files: (options.files ?? []) as unknown as FileList,
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: Object.assign(vi.fn((type: string, value: string) => {
      stored.set(type, value);
    }), {}) as unknown as DataTransfer['setData'],
    getData: ((type: string) =>
      options.uid !== undefined && type === SERIES_UID_MIME
        ? options.uid
        : (stored.get(type) ?? '')) as unknown as DataTransfer['getData'],
  } as unknown as DataTransfer;
}

describe('seriesDragDrop 纯函数', () => {
  it('readSeriesUidFromDataTransfer：读取 uid；空/缺失返回 null', () => {
    expect(readSeriesUidFromDataTransfer(null)).toBeNull();
    expect(readSeriesUidFromDataTransfer(makeDataTransfer())).toBeNull();
    expect(readSeriesUidFromDataTransfer(makeDataTransfer({ uid: 'uid-x' }))).toBe('uid-x');
  });

  it('isSeriesDragEvent：按 dataTransfer.types 判定内部序列拖拽', () => {
    const asDragEvent = (types: string[]) =>
      ({ dataTransfer: makeDataTransfer({ types }) }) as unknown as DragEvent;
    expect(isSeriesDragEvent(asDragEvent([SERIES_UID_MIME]))).toBe(true);
    expect(isSeriesDragEvent(asDragEvent(['Files', SERIES_UID_MIME]))).toBe(true);
    expect(isSeriesDragEvent(asDragEvent(['Files']))).toBe(false);
    expect(isSeriesDragEvent({ dataTransfer: null } as unknown as DragEvent)).toBe(false);
  });
});

describe('序列卡片拖拽到指定视口（App 集成）', () => {
  beforeEach(() => {
    const fakeViewport = {
      setStack: vi.fn(async () => undefined),
      render: vi.fn(),
      setProperties: vi.fn(),
      getProperties: vi.fn(() => ({ voiRange: { lower: -400, upper: 400 } })),
      getCurrentImageIdIndex: vi.fn(() => 0),
      getCamera: vi.fn(() => ({ parallelScale: 100 })),
      getZoom: vi.fn(() => 1),
      setCamera: vi.fn(),
      resetCamera: vi.fn(),
    };
    getRenderingEngineMock.mockReturnValue({
      enableElement: vi.fn(),
      disableElement: vi.fn(),
      getViewport: vi.fn(() => fakeViewport),
      resize: vi.fn(),
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** 渲染 App 并经 window drop 打开两个序列（openDicomFiles 已 mock） */
  async function renderAppWithTwoSeries() {
    const { default: App } = await import('../src/app/App');
    openDicomFilesMock.mockResolvedValue({
      opened: [makeOpened('1.2.series-b', 'dcm-file://b'), makeOpened('1.2.series-a', 'dcm-file://a')],
      failures: [],
    });
    const view = render(<App />);
    // 模拟外部文件拖放 → handleFiles → 面板出现两张序列卡片
    await act(async () => {
      fireEvent.drop(window, {
        dataTransfer: makeDataTransfer({ types: ['Files'], files: [new File([], 'a')] }),
      });
      await Promise.resolve();
    });
    return view;
  }

  it('序列卡片 dragstart：dataTransfer 携带 seriesUid（自定义 MIME）', async () => {
    const { container } = await renderAppWithTwoSeries();

    const cards = container.querySelectorAll<HTMLButtonElement>('.series-item');
    expect(cards).toHaveLength(2);

    const dataTransfer = makeDataTransfer({ types: [] });
    fireEvent.dragStart(cards[1]!, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(SERIES_UID_MIME, '1.2.series-b');
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('视口 dragover 高亮 + drop 将序列加载到该视口', async () => {
    const { container } = await renderAppWithTwoSeries();

    const cards = container.querySelectorAll<HTMLButtonElement>('.series-item');
    const cell = container.querySelector<HTMLDivElement>('.viewport-cell');
    expect(cell).not.toBeNull();

    // 初始：vp-0 自动加载第一个序列（series-a 排序在前）
    expect(cards[0]!.className).toContain('series-item--active');

    // dragover：悬停高亮
    fireEvent.dragOver(cell!, {
      dataTransfer: makeDataTransfer({ types: [SERIES_UID_MIME] }),
    });
    expect(cell!.className).toContain('viewport-cell--drop-target');

    // drop：series-b 加载到该视口（vp-0 当前激活）
    await act(async () => {
      fireEvent.drop(cell!, {
        dataTransfer: makeDataTransfer({ types: [SERIES_UID_MIME], uid: '1.2.series-b' }),
      });
      await Promise.resolve();
    });

    expect(cards[0]!.className).not.toContain('series-item--active');
    expect(container.querySelectorAll('.series-item')[1]!.className).toContain(
      'series-item--active',
    );
    // 高亮随放置结束清除
    expect(cell!.className).not.toContain('viewport-cell--drop-target');
    // 内部拖放不得触发文件重新解析
    expect(openDicomFilesMock).toHaveBeenCalledTimes(1);
  });

  it('非序列内容的 dragover/drop 不触发视口高亮与加载', async () => {
    const { container } = await renderAppWithTwoSeries();

    const cell = container.querySelector<HTMLDivElement>('.viewport-cell')!;
    const before = cell.className;

    fireEvent.dragOver(cell, { dataTransfer: makeDataTransfer({ types: ['Files'] }) });
    expect(cell.className).not.toContain('viewport-cell--drop-target');

    fireEvent.drop(cell, { dataTransfer: makeDataTransfer({ types: ['Files'] }) });
    expect(cell.className).not.toContain('viewport-cell--drop-target');
    expect(cell.className).toBe(before);
  });

  it('内部序列拖拽不触发全窗口文件拖放 UI（app--drag-active）', async () => {
    const { container } = await renderAppWithTwoSeries();
    const appRoot = container.querySelector<HTMLDivElement>('.app')!;

    // 外部文件拖入 → 显示拖放 overlay
    fireEvent.dragEnter(window, { dataTransfer: makeDataTransfer({ types: ['Files'] }) });
    expect(appRoot.className).toContain('app--drag-active');

    // 内部序列拖拽的 enter/leave 不改变文件拖放状态计数
    fireEvent.dragEnter(window, {
      dataTransfer: makeDataTransfer({ types: [SERIES_UID_MIME] }),
    });
    fireEvent.dragLeave(window, {
      dataTransfer: makeDataTransfer({ types: [SERIES_UID_MIME] }),
    });
    expect(appRoot.className).toContain('app--drag-active');

    // 外部拖拽离开后归零 → overlay 消失
    fireEvent.dragLeave(window, { dataTransfer: makeDataTransfer({ types: ['Files'] }) });
    expect(appRoot.className).not.toContain('app--drag-active');

    // 纯内部拖拽全程不应出现 overlay
    fireEvent.dragEnter(window, {
      dataTransfer: makeDataTransfer({ types: [SERIES_UID_MIME] }),
    });
    expect(appRoot.className).not.toContain('app--drag-active');
  });

  it('点击行为保留：点击序列仍加载到激活视口', async () => {
    const { container } = await renderAppWithTwoSeries();

    const cards = container.querySelectorAll<HTMLButtonElement>('.series-item');
    await act(async () => {
      fireEvent.click(cards[1]!);
      await Promise.resolve();
    });
    expect(container.querySelectorAll('.series-item')[1]!.className).toContain(
      'series-item--active',
    );
  });
});
