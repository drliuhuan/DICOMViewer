/**
 * cornerstone 标注运行时访问适配（FR-5.9/5.10/5.11，M10-D）。
 *
 * @cornerstonejs/tools 的 `state`/`annotation` 命名导出在部分测试 mock 中并不
 * 存在：直接静态命名导入会在访问绑定（__get__）时被 vitest 抛错。此模块统一用
 * 动态 import + 属性访问 try/catch 包装，缺依赖时降级为纯 no-op，避免改写既有
 * App 测试的 @cornerstonejs/tools mock。
 */
export interface AnnotationRuntime {
  getAllAnnotations?: () => readonly unknown[];
  removeAnnotation?: (uid: string) => void;
  addAnnotation?: (annotation: unknown, selector: unknown) => string | void;
  getSelected?: () => readonly string[];
  setSelected?: (uid: string, selected: boolean) => void;
  setVisibility?: (uid: string, visible: boolean) => void;
  showAll?: () => void;
}

const EMPTY: AnnotationRuntime = {};

let cache: AnnotationRuntime | null = null;
let loading = false;
let onReady: (() => void) | null = null;

/** 异步加载运行时；加载完成后调用 onReady（初次渲染后数据可见） */
export function ensureAnnotationRuntime(afterLoad: null | (() => void) = null): void {
  if (afterLoad !== null) {
    onReady = afterLoad;
  }
  if (loading || cache !== null) {
    return;
  }
  loading = true;
  void import('@cornerstonejs/tools')
    .then((toolsModule) => {
      const tools = toolsModule as Record<string, unknown>;
      let state: Record<string, unknown> | null = null;
      let selection: Record<string, unknown> | null = null;
      let visibility: Record<string, unknown> | null = null;
      try {
        state = (tools.state as Record<string, unknown> | undefined) ?? null;
      } catch {
        state = null;
      }
      try {
        const annotation = (tools.annotation as Record<string, unknown> | undefined) ?? null;
        selection = annotation
          ? ((annotation.selection as Record<string, unknown> | undefined) ?? null)
          : null;
        visibility = annotation
          ? ((annotation.visibility as Record<string, unknown> | undefined) ?? null)
          : null;
      } catch {
        selection = null;
        visibility = null;
      }
      const call = <T,>(fn: unknown): T | undefined => {
        try {
          return (fn as () => T | undefined)?.();
        } catch {
          return undefined;
        }
      };
      const fnType = <T>(fn: unknown): ((...args: never[]) => T) | undefined =>
        typeof fn === 'function' ? (fn as (...args: never[]) => T) : undefined;

      const runtime: AnnotationRuntime = {};
      const getAll = state?.getAllAnnotations;
      const removeOne = state?.removeAnnotation;
      const addOne = state?.addAnnotation;
      const getSelected = selection?.getAnnotationsSelected;
      const setSelected = selection?.setAnnotationSelected;
      const setVisibility = visibility?.setAnnotationVisibility;
      const showAll = visibility?.showAllAnnotations;

      runtime.getAllAnnotations =
        fnType<readonly unknown[]>(getAll) !== undefined
          ? () => call<readonly unknown[]>(fnType(getAll)) ?? []
          : undefined;
      runtime.removeAnnotation =
        fnType<void>(removeOne) !== undefined
          ? (uid) => {
              const callOne = fnType<void>(removeOne);
              if (callOne !== undefined) {
                callOne(uid as never);
              }
            }
          : undefined;
      runtime.addAnnotation =
        fnType<string>(addOne) !== undefined
          ? (annotation, selector) => {
              const callOne = fnType<string>(addOne);
              if (callOne !== undefined) {
                return callOne(annotation as never, selector as never);
              }
              return '';
            }
          : undefined;
      runtime.getSelected =
        fnType<readonly string[]>(getSelected) !== undefined
          ? () => call<readonly string[]>(fnType(getSelected)) ?? []
          : undefined;
      runtime.setSelected =
        fnType<void>(setSelected) !== undefined
          ? (uid, selected) => {
              const callOne = fnType<void>(setSelected);
              if (callOne !== undefined) {
                callOne(uid as never, selected as never);
              }
            }
          : undefined;
      runtime.setVisibility =
        fnType<void>(setVisibility) !== undefined
          ? (uid, visible) => {
              const callOne = fnType<void>(setVisibility);
              if (callOne !== undefined) {
                callOne(uid as never, visible as never);
              }
            }
          : undefined;
      runtime.showAll =
        fnType<void>(showAll) !== undefined
          ? () => {
              const callOne = fnType<void>(showAll);
              if (callOne !== undefined) {
                callOne();
              }
            }
          : undefined;
      cache = runtime;
      loading = false;
      const ready = onReady;
      onReady = null;
      ready?.();
    })
    .catch(() => {
      loading = false;
      onReady = null;
    });
}

/** 取运行时（尚未加载完成时返回 no-op 空实现） */
export function getAnnotationRuntime(): AnnotationRuntime {
  ensureAnnotationRuntime();
  return cache ?? EMPTY;
}