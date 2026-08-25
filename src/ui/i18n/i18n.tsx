/**
 * 轻量 i18n 框架（FR-12.3/NFR-9）：
 * - 默认语言 zh（决策已确认），可切 en；
 * - 词典查表 + 缺失回退 zh → 回退键名，支持 {var} 插值；
 * - I18nContext 默认值绑定 zh，未包裹 Provider 时组件行为不变
 *   （存量测试直接渲染 <App /> 不受影响）。
 *
 * TODO(FR-12.3)：存量组件（SeriesPanel/ErrorReportPanel/InfoOverlay/
 * ViewerCell 及 App 内进度条、toast、状态栏等）文案迁入词典。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { EN } from './en';
import { ZH } from './zh';

export type Lang = 'zh' | 'en';

export type Dict = Readonly<Record<string, string>>;

export const DICTS: Readonly<Record<Lang, Dict>> = { zh: ZH, en: EN };

/** 将 {name} 占位符替换为变量值；缺失变量保留原占位符 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** 查表：目标语言 → 中文回退 → 键名（永不返回 undefined） */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const template = DICTS[lang][key] ?? DICTS.zh[key] ?? key;
  return interpolate(template, vars);
}

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const defaultT = (key: string, vars?: Record<string, string | number>): string =>
  translate('zh', key, vars);

export const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => undefined,
  t: defaultT,
});

/** 取当前语言环境；未包裹 Provider 时回退 zh 默认实现 */
export function useT(): I18nContextValue {
  return useContext(I18nContext);
}

export interface I18nProviderProps {
  children: ReactNode;
  /** 初始语言（默认 zh） */
  initialLang?: Lang;
}

/** 独立使用场景（如单测/子应用）的 Provider；主应用由 App 内部注入 */
export function I18nProvider({ children, initialLang = 'zh' }: I18nProviderProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
