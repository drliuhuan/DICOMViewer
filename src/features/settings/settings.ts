/**
 * 应用设置（FR-12 子集：主题/语言/缓存上限/重置）。
 *
 * 纯逻辑 + 可注入依赖，Node 下单测；持久化于 localStorage
 * （键 dicom-viewer.settings.v1），读取失败/非法值一律回退默认。
 */
import type { Lang } from '../../ui/i18n/i18n';

export type ThemeMode = 'dark' | 'light';

export interface AppSettings {
  /** 主题（FR-12.2，默认深色——医学软件惯例） */
  theme: ThemeMode;
  /** 界面语言（FR-12.3，默认中文） */
  language: Lang;
  /** Cornerstone 图像缓存上限 MB（NFR-4；默认 256，范围 64–4096） */
  maxImageCacheMb: number;
  /** 缩略图缓存条数上限（FR-2.4 LRU；默认 100，范围 10–500） */
  thumbnailMaxCount: number;
}

export const SETTINGS_STORAGE_KEY = 'dicom-viewer.settings.v1';

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  theme: 'dark',
  language: 'zh',
  maxImageCacheMb: 256,
  thumbnailMaxCount: 100,
});

export const CACHE_MB_MIN = 64;
export const CACHE_MB_MAX = 4096;
const THUMB_MIN = 10;
const THUMB_MAX = 500;

function toInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 任意未知输入 → 合法设置（逐字段回退默认 + 夹紧范围，FR-12.7 重置共用） */
export function sanitizeSettings(input: unknown): AppSettings {
  const source =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const theme: ThemeMode = source.theme === 'light' ? 'light' : 'dark';
  const language: Lang = source.language === 'en' ? 'en' : 'zh';
  return {
    theme,
    language,
    maxImageCacheMb: clampInt(
      toInt(source.maxImageCacheMb, DEFAULT_SETTINGS.maxImageCacheMb),
      CACHE_MB_MIN,
      CACHE_MB_MAX,
    ),
    thumbnailMaxCount: clampInt(
      toInt(source.thumbnailMaxCount, DEFAULT_SETTINGS.thumbnailMaxCount),
      THUMB_MIN,
      THUMB_MAX,
    ),
  };
}

export function loadSettings(storage?: Pick<Storage, 'getItem'>): AppSettings {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = store?.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return { ...DEFAULT_SETTINGS };
    }
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    store?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用（隐私模式等）：静默降级为仅内存设置
  }
}

/** 主题落到 <html data-theme>（styles.css 以 CSS 变量实现深浅两套配色） */
export function applyTheme(theme: ThemeMode, root?: { dataset: Record<string, string> }): void {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (target) {
    target.dataset.theme = theme;
  }
}

export interface CacheApiLike {
  /** @cornerstonejs/core cache.setMaxCacheSize（字节） */
  setMaxCacheSize: (bytes: number) => void;
}

export interface SettingsEffectsDeps {
  /** 主题落点（默认 document.documentElement） */
  root?: { dataset: Record<string, string> };
  /** Cornerstone 图像缓存（缺省则跳过——单测/未初始化管线场景） */
  cacheApi?: CacheApiLike;
  /** 缩略图缓存上限写入（默认接入 thumbnails 模块） */
  setThumbnailLimit?: (count: number) => void;
}

/**
 * 应用设置的副作用：主题、Cornerstone 图像缓存上限（MB→字节）、
 * 缩略图 LRU 上限。纯函数式入口，便于单测断言调用链。
 */
export function applySettingsEffects(settings: AppSettings, deps: SettingsEffectsDeps = {}): void {
  applyTheme(settings.theme, deps.root);
  if (deps.cacheApi !== undefined) {
    deps.cacheApi.setMaxCacheSize(settings.maxImageCacheMb * 1024 * 1024);
  }
  deps.setThumbnailLimit?.(settings.thumbnailMaxCount);
}
