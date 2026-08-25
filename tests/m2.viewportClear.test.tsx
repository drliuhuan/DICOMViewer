/**
 * M2 验收缺陷回归（FR-2.9）：关闭序列后视口图像未清除。
 *
 * 根因：堆栈 effect 的 imageIds.length === 0 分支只重置了 React UI 状态，
 * cornerstone 视口 canvas 上仍残留旧图像（releaseSeries 只释放缓存/注册表）。
 *
 * @cornerstonejs/core@5.8.2 的 StackViewport 无 clear() API（源码确认：
 * RenderingEngine/StackViewport.d.ts 公开方法表无 clear，fillWithBackgroundColor
 * 为私有），等效清空 = removeAllActors（移除堆栈图像 actor，
 * 场景内不再有任何渲染体）+ render（下一帧仅渲染背景 [0,0,0]，画布纯黑）；
 * 后续 setStack 会重新 addActors，无副作用。
 *
 * 本文件 mock @cornerstonejs/core 与渲染管线初始化（jsdom 无 WebGL），
 * 锁定：加载后 items 变空 → viewport.removeAllActors()/render() 被调用、
 * UI 状态归零；viewport 未就绪时静默跳过不报错；清空后可再次加载。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const { getRenderingEngineMock } = vi.hoisted(() => ({
  getRenderingEngineMock: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  Enums: {
    ViewportType: { STACK: 'stack' },
    Events: {
      STACK_VIEWPORT_SCROLL: 'cornerstonetoolsstackviewportscroll',
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
  initializeTools: vi.fn(async () => undefined),
  createBoundToolGroup: vi.fn(() => ({ id: 'fake-tool-group' })),
  destroyBoundToolGroup: vi.fn(),
  syncToolBindings: vi.fn(),
}));

import { DicomViewport } from '../src/features/viewer/DicomViewport';
import type { ViewportUiState } from '../src/features/viewer/DicomViewport';
import type { StackItem } from '../src/features/series/buildStacks';

function makeFakeEngine() {
  // 有状态桩：setStack 添加堆栈 actor，removeAllActors 移除，
  // 与 @cornerstonejs/core 实际语义一致（getActors 反映当前渲染体）
  let actors: Array<{ uid: string }> = [];
  const fakeViewport = {
    setStack: vi.fn(async () => {
      actors = [{ uid: 'stack-actor' }];
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
    removeAllActors: vi.fn(() => {
      actors = [];
    }),
  };
  const engine = {
    enableElement: vi.fn(),
    disableElement: vi.fn(),
    getViewport: vi.fn(() => fakeViewport),
    resize: vi.fn(),
  };
  return { engine, fakeViewport };
}

function makeStackItems(count: number): StackItem[] {
  return Array.from({ length: count }, (_, i) => ({
    imageId: `dcm-file://series-x?instance=i${i}&frame=1`,
    fileName: `i${i}.dcm`,
    frameNumber: 1,
    summary: { modality: 'CT' },
  })) as unknown as StackItem[];
}

async function settle(rounds = 6): Promise<void> {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

describe('DicomViewport 关闭序列后清空视口图像（FR-2.9）', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('items 由堆栈变空：viewport.removeAllActors() + render() 被调用，UI 状态归零', async () => {
    const { engine, fakeViewport: vp } = makeFakeEngine();
    getRenderingEngineMock.mockReturnValue(engine);

    const uiStates: ViewportUiState[] = [];
    const items = makeStackItems(3);
    const view = render(
      <DicomViewport
        viewportId="vp-0"
        items={items}
        showInfo={false}
        onUiChange={(ui) => {
          uiStates.push(ui);
        }}
      />,
    );
    // 挂载 → 管线就绪 → setStack 加载 3 层
    await settle();
    expect(vp.setStack).toHaveBeenCalledTimes(1);
    expect(vp.setStack).toHaveBeenCalledWith(
      expect.arrayContaining(['dcm-file://series-x?instance=i0&frame=1']),
    );

    // 关闭序列：items 置空（App 层 assignments 置 null 后的等价形态）
    await act(async () => {
      view.rerender(
        <DicomViewport
          viewportId="vp-0"
          items={[]}
          showInfo={false}
          onUiChange={(ui) => {
            uiStates.push(ui);
          }}
        />,
      );
    });

    // 视口清空：移除图像 actor 并重新渲染（空场景 → 纯黑背景）。
    // 清空严格发生在移除 actor 之后（加载路径的 render 在更早）
    expect(vp.removeAllActors).toHaveBeenCalledTimes(1);
    expect(vp.render).toHaveBeenCalledTimes(2); // 1 次加载 + 1 次清空
    expect(vp.render.mock.invocationCallOrder[1]!).toBeGreaterThan(
      vp.removeAllActors.mock.invocationCallOrder[0]!,
    );
    // 清空后场景内无 actor（幂等状态）
    expect(vp.getActors()).toEqual([]);
    // UI 状态归零
    const lastUi = uiStates[uiStates.length - 1];
    expect(lastUi?.sliceIndex).toBe(0);
    expect(lastUi?.sliceCount).toBe(0);
  });

  it('viewport 未就绪（pipeline 初始化中）时 items 置空：静默跳过不报错', async () => {
    const { engine, fakeViewport } = makeFakeEngine();
    getRenderingEngineMock.mockReturnValue(engine);
    const view = render(
      <DicomViewport viewportId="vp-0" items={[]} showInfo={false} />,
    );
    // 同步阶段 viewportRef 必为 null；pipeline 就绪后 effect 重跑，
    // 但视口从未加载过堆栈（无 actor）→ 幂等跳过，不产生清空调用
    await expect(settle()).resolves.toBeUndefined();
    expect(engine.enableElement).toHaveBeenCalledTimes(1);
    // 未加载过堆栈：setStack 从未被调用
    expect(fakeViewport.setStack).not.toHaveBeenCalled();
    expect(fakeViewport.removeAllActors).not.toHaveBeenCalled();
    view.unmount();
    expect(engine.disableElement).toHaveBeenCalledWith('vp-0');
  });

  it('removeAllActors 抛错（视口禁用/引擎销毁竞态）时静默吞掉', async () => {
    const { engine, fakeViewport } = makeFakeEngine();
    getRenderingEngineMock.mockReturnValue(engine);
    const items = makeStackItems(2);
    const view = render(
      <DicomViewport viewportId="vp-0" items={items} showInfo={false} />,
    );
    await settle();
    expect(fakeViewport.setStack).toHaveBeenCalledTimes(1);

    fakeViewport.removeAllActors.mockImplementation(() => {
      throw new Error('viewport disabled');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      view.rerender(
        <DicomViewport viewportId="vp-0" items={[]} showInfo={false} />,
      );
    });
    spy.mockRestore();
    // 抛错被吞掉且 UI 仍归零（无残留错误提示）
    expect(view.container.querySelector('.viewport-error')).toBeNull();
  });

  it('清空后可再次加载新堆栈：setStack 重新调用（清空无副作用）', async () => {
    const { engine, fakeViewport } = makeFakeEngine();
    getRenderingEngineMock.mockReturnValue(engine);
    const itemsA = makeStackItems(2);
    const view = render(
      <DicomViewport
        viewportId="vp-0"
        items={itemsA}
        showInfo={false}
      />,
    );
    await settle();
    expect(fakeViewport.setStack).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.rerender(<DicomViewport viewportId="vp-0" items={[]} showInfo={false} />);
    });
    expect(fakeViewport.removeAllActors).toHaveBeenCalledTimes(1);

    const itemsB = makeStackItems(5);
    await act(async () => {
      view.rerender(
        <DicomViewport viewportId="vp-0" items={itemsB} showInfo={false} />,
      );
    });
    await settle();
    expect(fakeViewport.setStack).toHaveBeenCalledTimes(2);
    expect(fakeViewport.setStack).toHaveBeenLastCalledWith(
      expect.arrayContaining(['dcm-file://series-x?instance=i4&frame=1']),
    );
  });
});
