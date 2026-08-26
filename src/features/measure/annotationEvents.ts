/**
 * 标注事件订阅（FR-5.7/5.9，M10-D）。
 *
 * cornerstone 标注增删改/选中变更通过 core 的全局 eventTarget 派发
 * （CORNERSTONE_TOOLS_ANNOTATION_*）。此模块动态引入依赖并做缺省守卫，
 * 在 mocks 未暴露 eventTarget/Enums 的测试环境自动降级为 no-op。
 */

export interface AnnotationEventTarget {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function guard(target: AnnotationEventTarget | undefined, events: Record<string, string> | undefined) {
  if (target === undefined || events === undefined) {
    return null;
  }
  const names: string[] = [
    events.ANNOTATION_ADDED,
    events.ANNOTATION_COMPLETED,
    events.ANNOTATION_MODIFIED,
    events.ANNOTATION_REMOVED,
    events.ANNOTATION_SELECTION_CHANGE,
  ].filter((name): name is string => typeof name === 'string');
  return names;
}

/** 订阅全部标注事件；返回取消订阅函数（始终可安全调用）。 */
export function subscribeAnnotationEvents(
  handler: () => void,
): () => void {
  let unsub: (() => void) | null = null;
  void (async () => {
    try {
      const core = await import('@cornerstonejs/core');
      const tools = await import('@cornerstonejs/tools');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = (core as any).eventTarget as AnnotationEventTarget | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events = (tools as any).Enums?.Events as Record<string, string> | undefined;
      const names = guard(target, events);
      if (target === undefined || names === null) {
        return;
      }
      const listener = (): void => handler();
      for (const name of names) {
        target.addEventListener(name, listener);
      }
      unsub = () => {
        for (const name of names) {
          target.removeEventListener(name, listener);
        }
      };
    } catch {
      // 依赖缺失/初始化失败：本次订阅 no-op
    }
  })();
  return () => {
    unsub?.();
    unsub = null;
  };
}