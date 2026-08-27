/// <reference types="vite/client" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import stylesSource from '../src/app/styles.css?raw';

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
  DEFAULT_PRIMARY_TOOL: 'Pan',
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: vi.fn(() => ({ id: 'fake-tool-group' })),
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

vi.mock('../src/features/loading/openDicomFiles', () => ({
  openDicomFiles: vi.fn(async () => ({ opened: [], failures: [] })),
}));

// 横幅位于工具栏，与视口无关：stub 掉 ViewerCell 以隔离视口渲染副作用
vi.mock('../src/features/viewer/ViewerCell', () => ({
  ViewerCell: () => <div data-testid="viewer-cell-stub" />,
}));

describe('工具栏操作提示横幅移除', () => {
  beforeEach(() => {
    const fakeViewport = {};
    getRenderingEngineMock.mockReturnValue({
      enableElement: vi.fn(),
      disableElement: vi.fn(),
      getViewport: vi.fn(() => fakeViewport),
      resize: vi.fn(),
    });
    vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('App 渲染输出不含操作提示文案', async () => {
    const { default: App } = await import('../src/app/App');
    const { container } = render(<App />);

    expect(container.textContent).not.toContain('多选/拖拽打开');
    expect(container.textContent).not.toContain('点击序列载入激活视口');
    expect(container.textContent).not.toContain(
      '多选/拖拽打开 · 滚轮翻页 · Ctrl+滚轮缩放 · 中键平移 · 点击序列载入激活视口',
    );
  });

  it('.toolbar-hint 元素与样式类无残留（无空白占位节点）', async () => {
    const { default: App } = await import('../src/app/App');
    const { container } = render(<App />);

    expect(container.querySelector('.toolbar-hint')).toBeNull();
    // 工具栏其余控件不受影响
    expect(container.querySelector('.toolbar')).not.toBeNull();
    expect(container.textContent).toContain('打开文件');

    // 样式表层面：.toolbar-hint 规则已删除（无残留空白占位样式）
    expect(stylesSource).not.toContain('.toolbar-hint');
  });
});
