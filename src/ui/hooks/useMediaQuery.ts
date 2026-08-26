/**
 * 媒体查询 Hook（M9，FR-14.2 响应式布局）：
 * - 订阅 window.matchMedia 的 change 事件（含旧 Safari 的 addListener 回退）；
 * - matchMedia 不可用（如 jsdom 单测）时返回 fallback，不抛错；
 * - matchMedia 可注入，便于单测按断言驱动查询结果。
 */
import { useEffect, useState } from 'react';

/** 窄屏（手机）断点：≤767px（FR-14.2 手机档） */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export interface MediaQueryLike {
  readonly matches: boolean;
  readonly media: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export type MatchMediaLike = (query: string) => MediaQueryLike;

export function useMediaQuery(
  query: string,
  matchMedia?: MatchMediaLike,
  fallback = false,
): boolean {
  const mm = matchMedia ?? (typeof window !== 'undefined' ? window.matchMedia : undefined);
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof mm !== 'function') {
      return fallback;
    }
    try {
      return mm(query).matches;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    if (typeof mm !== 'function') {
      return undefined;
    }
    let mql: MediaQueryLike;
    try {
      mql = mm(query);
    } catch {
      return undefined;
    }
    setMatches(mql.matches);
    const onChange = () => setMatches(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener?.('change', onChange);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener?.(onChange);
    }
    return undefined;
  }, [query, mm]);

  return matches;
}
