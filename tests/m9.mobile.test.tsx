/**
 * M9 移动端 App 集成（FR-14.2/14.3/14.4）：
 * - 响应式布局（FR-14.2）：窄屏（≤767px）序列面板折叠为抽屉
 *   （默认隐藏 → 工具栏按钮唤出 → 选择序列/点遮罩关闭）；宽屏保持内联面板；
 * - 文件打开适配（FR-14.3/AC-29）：iOS 禁用「打开文件夹」并展示
 *   「多选文件 / 从 PACS/URL 加载」引导；Android/桌面按钮可用且无提示；
 * - 性能自适应（FR-14.4/AC-30）：低内存设备（deviceMemory≤4GB 或
 *   iOS 无该 API）缩略图 LRU 上限减半（100→50）；桌面不降级。
 *
 * mock 手法同 m1.multiViewport.test.tsx（渲染管线/工具/文件打开全部 mock），
 * 另注入可控 matchMedia 与可覆写的 navigator.userAgent/deviceMemory。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

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

const createBoundToolGroupMock = vi.hoisted(() =>
  vi.fn((_: string, viewportId: string) => ({ id: `tg-${viewportId}` })),
);

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
  DEFAULT_PRIMARY_TOOL: 'Pan',
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: createBoundToolGroupMock,
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

const openDicomFilesMock = vi.hoisted(() => vi.fn());

vi.mock('../src/features/loading/openDicomFiles', () => ({
  openDicomFiles: openDicomFilesMock,
}));

import {
  clearThumbnails,
  getThumbnailMaxCount,
  setThumbnailMaxCount,
} from '../src/features/series/thumbnails';

const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

/** 可控 matchMedia：mobileMatches 驱动 (max-width: 767px) 查询结果 */
let mobileMatches = false;
const changeListeners: Array<() => void> = [];
const matchMediaMock = vi.fn((query: string) => ({
  media: query,
  get matches() {
    return mobileMatches;
  },
  addEventListener: (type: string, listener: () => void) => {
    if (type === 'change') {
      changeListeners.push(listener);
    }
  },
  removeEventListener: vi.fn(),
}));

function setUserAgent(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  });
}

function setDeviceMemory(value: number | undefined): void {
  Object.defineProperty(window.navigator, 'deviceMemory', {
    value,
    configurable: true,
  });
}

function makeOpenedFile(seriesUid: string, baseImageId: string) {
  return {
    fileName: `${seriesUid}.dcm`,
    fileSizeBytes: 128,
    baseImageId,
    summary: {
      patientName: '',
      modality: 'CT',
      seriesInstanceUid: seriesUid,
      seriesNumber: 1,
      rows: 8,
      columns: 8,
      bitsAllocated: 16,
      numberOfFrames: 1,
    },
  };
}

function makeViewportStub() {
  const actors: Array<{ uid: string }> = [];
  return {
    setStack: vi.fn(async () => {
      actors.push({ uid: 'stack-actor' });
    }),
    render: vi.fn(),
    setProperties: vi.fn(),
    getProperties: vi.fn(() => ({ voiRange: { lower: -400, upper: 400 } })),
    getCurrentImageIdIndex: vi.fn(() => 0),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    getActors: vi.fn(() => actors),
    removeAllActors: vi.fn(),
  };
}

type ViewportStub = ReturnType<typeof makeViewportStub>;

function makeEngineStub() {
  const viewports = new Map<string, ViewportStub>();
  return {
    viewports,
    engine: {
      enableElement: vi.fn((options: { viewportId: string }) => {
        viewports.set(options.viewportId, makeViewportStub());
      }),
      disableElement: vi.fn(),
      getViewport: vi.fn((_id: string) => viewports.get(_id) ?? null),
      resize: vi.fn(),
    },
  };
}

async function settle(rounds = 8): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

function fireWindowDrop(): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: [new File([], 'a')] },
  });
  window.dispatchEvent(event);
}

describe('M9 移动端 App 集成', () => {
  beforeEach(() => {
    mobileMatches = false;
    changeListeners.length = 0;
    setUserAgent(UA_DESKTOP);
    setDeviceMemory(undefined);
    localStorage.clear();
    clearThumbnails();
    setThumbnailMaxCount(100);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('matchMedia', matchMediaMock);
    matchMediaMock.mockClear();
    openDicomFilesMock.mockResolvedValue({
      opened: [
        makeOpenedFile('1.2.series-b', 'dcm-file://b'),
        makeOpenedFile('1.2.series-a', 'dcm-file://a'),
      ],
      failures: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  async function renderApp() {
    const { default: App } = await import('../src/app/App');
    const engineStub = makeEngineStub();
    getRenderingEngineMock.mockReturnValue(engineStub.engine);
    const view = await act(async () => render(<App />));
    return { ...engineStub, view };
  }

  async function renderAppWithSeries(mobile: boolean) {
    mobileMatches = mobile;
    const ctx = await renderApp();
    await act(async () => {
      fireWindowDrop();
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }
    });
    return ctx;
  }

  function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === text,
    );
  }

  describe('响应式布局（FR-14.2）', () => {
    it('宽屏：序列面板内联展示，无抽屉按钮', async () => {
      const { view } = await renderAppWithSeries(false);
      expect(view.container.querySelector('.series-panel')).not.toBeNull();
      expect(view.container.querySelector('.series-drawer')).toBeNull();
      expect(buttonByText(view.container, '☰ 序列')).toBeUndefined();
    });

    it('窄屏：序列面板默认隐藏（视口全屏），工具栏出现抽屉按钮', async () => {
      const { view } = await renderAppWithSeries(true);
      expect(view.container.querySelector('.series-panel')).toBeNull();
      expect(buttonByText(view.container, '☰ 序列')).toBeDefined();
    });

    it('窄屏：按钮唤出抽屉 → 选择序列后抽屉关闭且序列加载到激活视口', async () => {
      const { view, viewports } = await renderAppWithSeries(true);

      fireEvent.click(buttonByText(view.container, '☰ 序列')!);
      expect(view.container.querySelector('.series-drawer')).not.toBeNull();
      expect(view.container.querySelector('.drawer-backdrop')).not.toBeNull();
      const items = view.container.querySelectorAll('.series-drawer .series-item');
      expect(items.length).toBe(2);

      // 点击第二张卡片（series-b）→ 加载到激活视口 vp-0 且抽屉关闭
      fireEvent.click(items[1]!);
      await settle();
      expect(view.container.querySelector('.series-drawer')).toBeNull();
      expect(viewports.get('vp-0')!.setStack).toHaveBeenCalledWith(['dcm-file://b']);

      // 再次唤出：已加载序列卡片带激活态
      fireEvent.click(buttonByText(view.container, '☰ 序列')!);
      const activeItems = view.container.querySelectorAll(
        '.series-drawer .series-item--active',
      );
      expect(activeItems.length).toBe(1);
      expect(activeItems[0]!.textContent).toContain('CT');
    });

    it('窄屏：点击遮罩关闭抽屉', async () => {
      const { view } = await renderAppWithSeries(true);
      fireEvent.click(buttonByText(view.container, '☰ 序列')!);
      expect(view.container.querySelector('.series-drawer')).not.toBeNull();
      fireEvent.click(view.container.querySelector('.drawer-backdrop')!);
      expect(view.container.querySelector('.series-drawer')).toBeNull();
    });

    it('窄屏 ↔ 宽屏切换（matchMedia change）：抽屉态随断点收敛', async () => {
      const { view } = await renderAppWithSeries(true);
      fireEvent.click(buttonByText(view.container, '☰ 序列')!);
      expect(view.container.querySelector('.series-drawer')).not.toBeNull();

      // 旋转/窗口变化切到宽屏：抽屉不再渲染（内联面板恢复）
      mobileMatches = false;
      await act(async () => {
        for (const listener of changeListeners) {
          listener();
        }
        await Promise.resolve();
      });
      expect(view.container.querySelector('.series-drawer')).toBeNull();
      expect(view.container.querySelector('.series-panel')).not.toBeNull();
    });
  });

  describe('文件打开适配（FR-14.3/AC-29）', () => {
    it('iOS：禁用「打开文件夹」并展示多选文件 / PACS 引导提示', async () => {
      setUserAgent(UA_IPHONE);
      const { view } = await renderApp();
      const folderButton = buttonByText(view.container, '打开文件夹');
      expect(folderButton).toBeDefined();
      expect(folderButton!.disabled).toBe(true);
      const hint = view.container.querySelector('.mobile-open-hint');
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toContain('PACS');
      // 多选文件入口（multiple）保持可用
      const fileInputs = view.container.querySelectorAll('input[type="file"][multiple]');
      expect(fileInputs.length).toBeGreaterThanOrEqual(1);
    });

    it('Android：文件夹按钮可用且无能力提示', async () => {
      setUserAgent(UA_ANDROID);
      const { view } = await renderApp();
      const folderButton = buttonByText(view.container, '打开文件夹');
      expect(folderButton!.disabled).toBe(false);
      expect(view.container.querySelector('.mobile-open-hint')).toBeNull();
    });

    it('桌面：文件夹按钮可用且无能力提示', async () => {
      const { view } = await renderApp();
      expect(buttonByText(view.container, '打开文件夹')!.disabled).toBe(false);
      expect(view.container.querySelector('.mobile-open-hint')).toBeNull();
    });
  });

  describe('性能自适应（FR-14.4/AC-30）', () => {
    it('低内存 Android（deviceMemory=4GB）：缩略图 LRU 上限减半 100→50', async () => {
      setUserAgent(UA_ANDROID);
      setDeviceMemory(4);
      await renderApp();
      expect(getThumbnailMaxCount()).toBe(50);
    });

    it('iOS（无 deviceMemory API）：按低内存处理，上限减半', async () => {
      setUserAgent(UA_IPHONE);
      await renderApp();
      expect(getThumbnailMaxCount()).toBe(50);
    });

    it('高内存 Android（deviceMemory=8GB）：不降级（100）', async () => {
      setUserAgent(UA_ANDROID);
      setDeviceMemory(8);
      await renderApp();
      expect(getThumbnailMaxCount()).toBe(100);
    });

    it('桌面（无 deviceMemory API）：不降级（100）', async () => {
      await renderApp();
      expect(getThumbnailMaxCount()).toBe(100);
    });
  });
});
