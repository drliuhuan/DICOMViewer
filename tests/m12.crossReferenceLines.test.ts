// @vitest-environment jsdom
/**
 * M12-F1 跨视口切面定位线（FR-3.15）：
 * - 纯几何单测：正交/斜交/平行/重合、FrameOfReferenceUID、裁切、退化参数；
 * - App 集成：1×2 双序列下激活视口切换、翻层随动、开关、空视口/同序列不画线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  CROSS_REFERENCE_LINE_COLOR,
  computeCrossReferenceSegment,
  type SlicePlaneGeometry,
} from '../src/features/viewer/crossReferenceLines';
import type { LineSegment, Point2, Point3 } from '../src/features/mpr/referenceLines';

const { getRenderingEngineMock } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'cornerstonestackviewportscroll',
      STACK_NEW_IMAGE: 'cornerstonestacknewimage',
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
  cache: { setMaxCacheSize: vi.fn(), removeImageLoadObject: vi.fn() },
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
  createBoundToolGroup: vi.fn((_: string, viewportId: string) => ({ id: `tg-${viewportId}` })),
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

type Geometry = {
  origin: [number, number, number];
  direction: [number, number, number, number, number, number, number, number, number];
  spacing: [number, number];
  dimensions: [number, number];
};

const GEOMETRY = new Map<string, Geometry>();

function makeOpenedFile(
  seriesUid: string,
  baseImageId: string,
  slice: number,
  plane: 'axial' | 'sagittal',
) {
  const offset = (slice - 1) * 2;
  const orientation = plane === 'axial' ? [1, 0, 0, 0, 1, 0] : [0, 0, 1, 0, 1, 0];
  const position = plane === 'axial' ? [0, 0, offset] : [offset, 0, 0];
  GEOMETRY.set(baseImageId, {
    origin: position as [number, number, number],
    direction: [
      orientation[0]!,
      orientation[1]!,
      orientation[2]!,
      orientation[3]!,
      orientation[4]!,
      orientation[5]!,
      0,
      0,
      1,
    ],
    spacing: [1, 1],
    dimensions: [10, 10],
  });
  return {
    fileName: `${seriesUid}-${slice}.dcm`,
    fileSizeBytes: 128,
    baseImageId,
    summary: {
      patientName: '',
      patientId: undefined,
      patientSex: undefined,
      patientAge: undefined,
      modality: 'CT',
      studyInstanceUid: '1.2.study',
      studyDate: undefined,
      studyDescription: undefined,
      institutionName: undefined,
      seriesInstanceUid: seriesUid,
      seriesNumber: plane === 'axial' ? 1 : 2,
      seriesDescription: plane === 'axial' ? 'AXIAL' : 'SAGITTAL',
      instanceNumber: slice,
      sliceLocation: offset,
      sliceThickness: 2,
      pixelSpacing: [1, 1],
      imagePositionPatient: position,
      imageOrientationPatient: orientation,
      perFrameImagePositions: undefined,
      windowWidth: 400,
      windowCenter: 40,
      rows: 10,
      columns: 10,
      bitsAllocated: 16,
      numberOfFrames: 1,
      sopClassUid: undefined,
      sopInstanceUid: `${seriesUid}.${slice}`,
      transferSyntaxUid: undefined,
      frameOfReferenceUid: '1.2.for',
    },
  };
}

const AXIAL_UID = '1.2.series-axial';
const SAGITTAL_UID = '1.2.series-sagittal';

function makeViewportStub(element?: HTMLElement) {
  let actors: Array<{ uid: string }> = [];
  let imageIds: string[] = [];
  let index = 0;
  const props: Record<string, unknown> = { voiRange: { lower: -400, upper: 400 } };
  return {
    setStack: vi.fn(async (ids: string[]) => {
      imageIds = ids;
      index = 0;
      actors = [{ uid: 'stack-actor' }];
    }),
    render: vi.fn(),
    setProperties: vi.fn((patch: Record<string, unknown>) => Object.assign(props, patch)),
    getProperties: vi.fn(() => ({ ...props })),
    getCurrentImageIdIndex: vi.fn(() => index),
    getCurrentImageId: vi.fn(() => imageIds[index] ?? ''),
    getImageData: vi.fn(() => {
      const g = GEOMETRY.get(imageIds[index] ?? '');
      return g === undefined ? undefined : { ...g, metadata: { FrameOfReferenceUID: '1.2.for' } };
    }),
    worldToCanvas: vi.fn((world: number[]) => {
      const g = GEOMETRY.get(imageIds[index] ?? '');
      if (!g) return undefined;
      const d = [
        (world[0] ?? 0) - g.origin[0],
        (world[1] ?? 0) - g.origin[1],
        (world[2] ?? 0) - g.origin[2],
      ];
      const c =
        (d[0]! * g.direction[0] + d[1]! * g.direction[1] + d[2]! * g.direction[2]) / g.spacing[0];
      const r =
        (d[0]! * g.direction[3] + d[1]! * g.direction[4] + d[2]! * g.direction[5]) / g.spacing[1];
      return [c * 10 + 50, r * 10 + 50];
    }),
    getCamera: vi.fn(() => ({ parallelScale: 100 })),
    getZoom: vi.fn(() => 1),
    setCamera: vi.fn(),
    resetCamera: vi.fn(),
    setImageIdIndex: vi.fn((next: number) => {
      index = next;
      // 真实 StackViewport 在图像数据切换后触发 STACK_NEW_IMAGE；
      // 这里是 FR-3.15「几何已到位」的重算触发信号。
      element?.dispatchEvent(
        new CustomEvent('cornerstonestacknewimage', { detail: { imageIdIndex: next } }),
      );
      return Promise.resolve();
    }),
    getRotation: vi.fn(() => 0),
    setRotation: vi.fn(),
    getActors: vi.fn(() => actors),
    removeAllActors: vi.fn(() => {
      actors = [];
    }),
  };
}

function makeEngineStub() {
  const viewports = new Map<string, ReturnType<typeof makeViewportStub>>();
  return {
    viewports,
    engine: {
      enableElement: vi.fn((options: { viewportId: string; element?: HTMLElement }) => {
        viewports.set(options.viewportId, makeViewportStub(options.element));
      }),
      disableElement: vi.fn(),
      getViewport: vi.fn((id: string) => viewports.get(id) ?? null),
      resize: vi.fn(),
    },
  };
}

/**
 * 模拟「层号先变、几何后到」：setImageIdIndex 只更新目标层号（getCurrentImageId
 * 立即反映目标），图像几何（getImageData）仍停留在已渲染的旧层，直到测试调用
 * complete() 才真正切换并触发 STACK_NEW_IMAGE。
 */
function deferImageSwitch(viewport: ReturnType<typeof makeViewportStub>) {
  const baseSet = viewport.setImageIdIndex.getMockImplementation()!;
  const baseGetIndex = viewport.getCurrentImageIdIndex.getMockImplementation()!;
  const baseGetImageId = viewport.getCurrentImageId.getMockImplementation()!;
  let pending: number | null = null;
  viewport.setImageIdIndex.mockImplementation((next: number) => {
    pending = next;
    return Promise.resolve();
  });
  viewport.getCurrentImageIdIndex.mockImplementation(() => pending ?? baseGetIndex());
  viewport.getCurrentImageId.mockImplementation(() => {
    if (pending === null) {
      return baseGetImageId();
    }
    return `dcm-file://axial-${pending + 1}`;
  });
  return {
    pending: () => pending,
    complete() {
      const next = pending;
      pending = null;
      if (next !== null) {
        baseSet(next);
      }
    },
  };
}

async function flush(rounds = 16): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

function fireDrop(): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: [new File([], 'all')] },
  });
  window.dispatchEvent(event);
}

async function renderLoaded() {
  const opened = [
    ...Array.from({ length: 5 }, (_, i) =>
      makeOpenedFile(AXIAL_UID, `dcm-file://axial-${i + 1}`, i + 1, 'axial'),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      makeOpenedFile(SAGITTAL_UID, `dcm-file://sagittal-${i + 1}`, i + 1, 'sagittal'),
    ),
  ];
  openDicomFilesMock.mockResolvedValue({ opened, failures: [], cancelled: false });
  const { engine, viewports } = makeEngineStub();
  getRenderingEngineMock.mockReturnValue(engine);
  const { default: App } = await import('../src/app/App');
  const view = await act(async () => render(createElement(App)));
  await act(async () => {
    fireDrop();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
  await flush();
  return { view, viewports };
}

function clickButton(container: HTMLElement, text: string): void {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  fireEvent.click(button);
}

function seriesCard(container: HTMLElement, text: string): Element {
  const card = Array.from(container.querySelectorAll('.series-item')).find((el) =>
    el.textContent?.includes(text),
  );
  if (!card) throw new Error(`series card not found: ${text}`);
  return card;
}

function cells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.viewport-cell'));
}

function lineLefts(cell: HTMLElement): number[] {
  return Array.from(cell.querySelectorAll<HTMLElement>('.reference-line')).map((el) =>
    Number.parseFloat(el.style.left),
  );
}

const FOR_UID = '1.2.840.10008.5.1.4.1.1.2.1';

/** 轴位目标平面：10×10 像素，1mm 间距，z=0 */
function axialTarget(overrides: Partial<SlicePlaneGeometry> = {}): SlicePlaneGeometry {
  return {
    frameOfReferenceUID: FOR_UID,
    origin: [0, 0, 0],
    rowDir: [1, 0, 0],
    colDir: [0, 1, 0],
    spacing: [1, 1],
    columns: 10,
    rows: 10,
    ...overrides,
  };
}

/** 矢状来源平面：x=5，行列方向使 c=z、r=y */
function sagittalSource(overrides: Partial<SlicePlaneGeometry> = {}): SlicePlaneGeometry {
  return {
    frameOfReferenceUID: FOR_UID,
    origin: [5, 0, 0],
    rowDir: [0, 0, 1],
    colDir: [0, 1, 0],
    spacing: [1, 1],
    columns: 10,
    rows: 10,
    ...overrides,
  };
}

/**
 * 斜交来源平面：法向 (1,1,1)/√3，过 (0,0,k)；
 * 与轴位目标 z=0 的交线为 c+r=k（目标像素坐标）。
 */
function obliqueSource(k: number, overrides: Partial<SlicePlaneGeometry> = {}): SlicePlaneGeometry {
  return {
    frameOfReferenceUID: FOR_UID,
    origin: [0, 0, k],
    rowDir: [Math.SQRT1_2, -Math.SQRT1_2, 0],
    colDir: [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)],
    spacing: [1, 1],
    columns: 10,
    rows: 10,
    ...overrides,
  };
}

function xs(segment: LineSegment): [number, number] {
  return [Math.min(segment.p1.x, segment.p2.x), Math.max(segment.p1.x, segment.p2.x)];
}

function ys(segment: LineSegment): [number, number] {
  return [Math.min(segment.p1.y, segment.p2.y), Math.max(segment.p1.y, segment.p2.y)];
}

function expectInside(segment: LineSegment, columns: number, rows: number): void {
  for (const p of [segment.p1, segment.p2] as Point2[]) {
    expect(p.x).toBeGreaterThanOrEqual(-1e-6);
    expect(p.x).toBeLessThanOrEqual(columns + 1e-6);
    expect(p.y).toBeGreaterThanOrEqual(-1e-6);
    expect(p.y).toBeLessThanOrEqual(rows + 1e-6);
  }
}

describe('computeCrossReferenceSegment（正交相交）', () => {
  it('激活矢状位（x=5）→ 轴位目标出现竖线 c=5', () => {
    const segment = computeCrossReferenceSegment(sagittalSource(), axialTarget());
    expect(segment).not.toBeNull();
    expect(xs(segment!)).toEqual([5, 5]);
    expect(ys(segment!)).toEqual([0, 10]);
    expectInside(segment!, 10, 10);
  });

  it('激活轴位（z=2）→ 矢状目标出现竖线 c=2（矢状目标 c=z）', () => {
    const target = sagittalSource();
    const source = axialTarget({ origin: [0, 0, 2] });
    const segment = computeCrossReferenceSegment(source, target);
    expect(segment).not.toBeNull();
    expect(xs(segment!)).toEqual([2, 2]);
    expect(ys(segment!)).toEqual([0, 10]);
  });

  it('像素间距参与坐标换算：2mm 间距下 x=6 落到像素 c=3', () => {
    const segment = computeCrossReferenceSegment(
      sagittalSource({ origin: [6, 0, 0] }),
      axialTarget({ spacing: [2, 3] }),
    );
    expect(segment).not.toBeNull();
    expect(xs(segment!)).toEqual([3, 3]);
    expect(ys(segment!)).toEqual([0, 10]);
  });
});

describe('computeCrossReferenceSegment（斜交）', () => {
  it('斜平面 c+r=3 与轴位目标相交为对角线段', () => {
    const segment = computeCrossReferenceSegment(obliqueSource(3), axialTarget());
    expect(segment).not.toBeNull();
    const points = [segment!.p1, segment!.p2];
    for (const p of points) {
      expect(p.x + p.y).toBeCloseTo(3, 6);
    }
    const sorted = points.slice().sort((a, b) => a.x - b.x);
    expect(sorted[0]!.x).toBeCloseTo(0, 6);
    expect(sorted[0]!.y).toBeCloseTo(3, 6);
    expect(sorted[1]!.x).toBeCloseTo(3, 6);
    expect(sorted[1]!.y).toBeCloseTo(0, 6);
    expectInside(segment!, 10, 10);
  });

  it('交线部分落在图像内：c+r=15 被裁切为 (5,10)-(10,5)', () => {
    const segment = computeCrossReferenceSegment(obliqueSource(15), axialTarget());
    expect(segment).not.toBeNull();
    expect(xs(segment!)).toEqual([5, 10]);
    expect(ys(segment!)).toEqual([5, 10]);
    expectInside(segment!, 10, 10);
  });

  it('交线完全在图像外：c+r=30 返回 null', () => {
    expect(computeCrossReferenceSegment(obliqueSource(30), axialTarget())).toBeNull();
    expect(
      computeCrossReferenceSegment(sagittalSource({ origin: [20, 0, 0] }), axialTarget()),
    ).toBeNull();
  });
});

describe('computeCrossReferenceSegment（平行/重合）', () => {
  it('两平面平行但不同层 → null（不画线）', () => {
    const source = axialTarget({ origin: [0, 0, 5] });
    expect(computeCrossReferenceSegment(source, axialTarget())).toBeNull();
  });

  it('两平面完全重合（同一序列同一层）→ null（不画线）', () => {
    expect(computeCrossReferenceSegment(axialTarget(), axialTarget())).toBeNull();
    expect(computeCrossReferenceSegment(obliqueSource(3), obliqueSource(3))).toBeNull();
  });
});

describe('computeCrossReferenceSegment（FrameOfReferenceUID）', () => {
  it('两侧 UID 不同 → null', () => {
    expect(
      computeCrossReferenceSegment(
        sagittalSource({ frameOfReferenceUID: '1.2.other' }),
        axialTarget(),
      ),
    ).toBeNull();
    expect(
      computeCrossReferenceSegment(
        sagittalSource(),
        axialTarget({ frameOfReferenceUID: '1.2.other' }),
      ),
    ).toBeNull();
  });

  it('任一侧 UID 缺失/空串 → null', () => {
    expect(
      computeCrossReferenceSegment(
        sagittalSource({ frameOfReferenceUID: undefined }),
        axialTarget(),
      ),
    ).toBeNull();
    expect(
      computeCrossReferenceSegment(sagittalSource(), axialTarget({ frameOfReferenceUID: '' })),
    ).toBeNull();
    expect(
      computeCrossReferenceSegment(sagittalSource({ frameOfReferenceUID: '   ' }), axialTarget()),
    ).toBeNull();
  });
});

describe('computeCrossReferenceSegment（退化参数）', () => {
  const source = sagittalSource();

  it('NaN/Infinity 坐标 → null', () => {
    expect(
      computeCrossReferenceSegment(
        { ...source, origin: [Number.NaN, 0, 0] as Point3 },
        axialTarget(),
      ),
    ).toBeNull();
    expect(
      computeCrossReferenceSegment(axialTarget({ origin: [0, 0, 2] }), {
        ...source,
        origin: [0, Number.POSITIVE_INFINITY, 0] as Point3,
      }),
    ).toBeNull();
  });

  it('零法向（行/列方向退化）→ null', () => {
    expect(
      computeCrossReferenceSegment({ ...source, rowDir: [0, 0, 0] as Point3 }, axialTarget()),
    ).toBeNull();
    expect(
      computeCrossReferenceSegment(source, axialTarget({ colDir: [0, 0, 0] as Point3 })),
    ).toBeNull();
  });

  it('非正 spacing / rows / columns → null', () => {
    expect(computeCrossReferenceSegment({ ...source, spacing: [0, 1] }, axialTarget())).toBeNull();
    expect(
      computeCrossReferenceSegment({ ...source, spacing: [1, Number.NaN] }, axialTarget()),
    ).toBeNull();
    expect(computeCrossReferenceSegment(source, axialTarget({ columns: 0 }))).toBeNull();
    expect(computeCrossReferenceSegment(source, axialTarget({ rows: -1 }))).toBeNull();
  });

  it('零长度输出/非有限端点不会出现（合法输入端点均有限）', () => {
    const segment = computeCrossReferenceSegment(sagittalSource(), axialTarget())!;
    for (const p of [segment.p1, segment.p2]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('跨视口定位线颜色', () => {
  it('统一黄色（不按平面取色）', () => {
    expect(CROSS_REFERENCE_LINE_COLOR).toBe('#ffff00');
  });
});

describe('App 集成：跨视口定位线（FR-3.15）', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    localStorage.clear();
    GEOMETRY.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('激活/切换/翻层/开关', async () => {
    const { view, viewports } = await renderLoaded();
    // 2 个序列已加载到 vp-0（轴位）
    clickButton(view.container, '1×2');
    await flush();

    // 激活 vp-1 并加载矢状位
    fireEvent.mouseDown(cells(view.container)[1]!);
    fireEvent.click(seriesCard(view.container, 'SAGITTAL'));
    await flush();
    // 激活矢状位 → 轴位 vp-0 出现线，矢状位自身无线
    expect(cells(view.container)[1]!.querySelector('.cross-reference-lines')).toBeNull();
    expect(cells(view.container)[0]!.querySelectorAll('.reference-line').length).toBe(1);

    // 激活轴位（vp-0）→ 矢状位 vp-1 出现一条线，轴位自身无线
    fireEvent.mouseDown(cells(view.container)[0]!);
    await flush();
    expect(cells(view.container)[0]!.querySelector('.cross-reference-lines')).toBeNull();
    const sagCell = cells(view.container)[1]!;
    expect(sagCell.querySelectorAll('.reference-line').length).toBe(1);
    expect(lineLefts(sagCell)[0]).toBeCloseTo(50, 3);
    expect(
      sagCell.querySelector('[data-testid="cross-reference-lines"]')?.getAttribute('data-line-color'),
    ).toBe(CROSS_REFERENCE_LINE_COLOR);

    // 轴位翻到第 3 层（z=4）→ 矢状位线移动到 c=4（left=90）
    const slider = cells(view.container)[0]!.querySelector<HTMLInputElement>('input[type=range]')!;
    fireEvent.change(slider, { target: { value: '2' } });
    await flush();
    expect(lineLefts(cells(view.container)[1]!)[0]).toBeCloseTo(90, 3);

    // 模拟目标视口相机平移（投影矩阵变化）→ CAMERA_MODIFIED 后线随图像重投影
    const targetViewport = viewports.get('vp-1')!;
    const baseProject = targetViewport.worldToCanvas.getMockImplementation()!;
    targetViewport.worldToCanvas.mockImplementation((world: number[]) => {
      const projected = baseProject(world);
      return projected === undefined ? undefined : [projected[0]! + 7, projected[1]!];
    });
    const targetElement = cells(view.container)[1]!.querySelector('.cornerstone-element')!;
    await act(async () => {
      targetElement.dispatchEvent(new Event('cornerstonecameramodified'));
    });
    await flush();
    expect(lineLefts(cells(view.container)[1]!)[0]).toBeCloseTo(97, 3);

    // 切换激活到矢状位 → 轴位出现线，矢状位无线
    fireEvent.mouseDown(cells(view.container)[1]!);
    await flush();
    expect(cells(view.container)[1]!.querySelector('.cross-reference-lines')).toBeNull();
    expect(cells(view.container)[0]!.querySelectorAll('.reference-line').length).toBe(1);

    // 开关关闭 → 全部消失；再开 → 恢复
    const toggle = view.container.querySelector<HTMLButtonElement>(
      'button[aria-pressed][aria-label*="跨视口参考线"]',
    )!;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    await flush();
    expect(view.container.querySelectorAll('.cross-reference-lines').length).toBe(0);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    await flush();
    expect(cells(view.container)[0]!.querySelectorAll('.reference-line').length).toBe(1);
  });

  it('同一序列同层 / 空视口 / 1×1 → 不画线（无残留）', async () => {
    const { view } = await renderLoaded();
    clickButton(view.container, '2×2');
    await flush();

    // 两个视口显示同一序列（同一层）→ 平面平行/重合，不画线
    fireEvent.mouseDown(cells(view.container)[1]!);
    fireEvent.click(seriesCard(view.container, 'AXIAL'));
    await flush();
    expect(view.container.querySelectorAll('.cross-reference-lines').length).toBe(0);

    // 空视口不参与，也不产生虚线/NaN 元素
    expect(cells(view.container)[2]!.querySelector('.cross-reference-lines')).toBeNull();
    expect(cells(view.container)[3]!.querySelector('.cross-reference-lines')).toBeNull();

    // 切回 1×1：唯一的激活视口不画自身线，无残留
    clickButton(view.container, '1×1');
    await flush();
    expect(view.container.querySelectorAll('.cross-reference-lines').length).toBe(0);
  });

  it('滑块：层号先变、几何后到 → 图像切换后补算一次，且不会无限重算', async () => {
    const { view, viewports } = await renderLoaded();
    clickButton(view.container, '1×2');
    await flush();

    // vp-1 加载矢状位，随后激活轴位 vp-0（矢状位出现随 z 移动的定位线）
    fireEvent.mouseDown(cells(view.container)[1]!);
    fireEvent.click(seriesCard(view.container, 'SAGITTAL'));
    await flush();
    fireEvent.mouseDown(cells(view.container)[0]!);
    await flush();

    const sagCell = cells(view.container)[1]!;
    expect(lineLefts(sagCell)[0]).toBeCloseTo(50, 3); // 第 1 层 z=0

    const axial = viewports.get('vp-0')!;
    const deferred = deferImageSwitch(axial);
    const slider = cells(view.container)[0]!.querySelector<HTMLInputElement>('input[type=range]')!;
    const readsBefore = axial.getImageData.mock.calls.length;

    // 拖到第 3 层：目标层号立即变化，但图像几何仍停留在旧层。
    fireEvent.change(slider, { target: { value: '2' } });
    await flush();
    expect(deferred.pending()).toBe(2);
    // 线保持与「当前显示图像」一致；不得用上一张图像的几何提前重算。
    expect(lineLefts(sagCell)[0]).toBeCloseTo(50, 3);
    expect(axial.getImageData.mock.calls.length).toBe(readsBefore);

    // 图像真正切换（STACK_NEW_IMAGE）→ 几何到位后补算一次，线跳到 z=4（left=90）。
    await act(async () => {
      deferred.complete();
    });
    await flush();
    expect(lineLefts(sagCell)[0]).toBeCloseTo(90, 3);
    const readsAfterForward = axial.getImageData.mock.calls.length;
    expect(readsAfterForward - readsBefore).toBe(1);

    // 反向拖回第 1 层：同样等几何到位后再更新，像素位置与滚轮语义一致。
    fireEvent.change(slider, { target: { value: '0' } });
    await flush();
    expect(deferred.pending()).toBe(0);
    expect(lineLefts(sagCell)[0]).toBeCloseTo(90, 3);
    await act(async () => {
      deferred.complete();
    });
    await flush();
    expect(lineLefts(sagCell)[0]).toBeCloseTo(50, 3);
    const readsAfterReverse = axial.getImageData.mock.calls.length;
    expect(readsAfterReverse - readsAfterForward).toBe(1);

    // 重算次数有界：继续推进事件循环不再触发几何读取，也不会残留多条线。
    await flush(20);
    expect(axial.getImageData.mock.calls.length).toBe(readsAfterReverse);
    expect(sagCell.querySelectorAll('.reference-line').length).toBe(1);
  });
});
