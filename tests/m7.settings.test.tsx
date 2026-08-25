/**
 * M7 设置测试（FR-12 子集）：
 * - sanitize/load/save 纯逻辑（非法值夹紧、损坏数据回退默认、持久化往返）；
 * - 主题落 <html data-theme>；
 * - applySettingsEffects 调用链（Cornerstone 缓存 MB→字节、缩略图 LRU 上限）；
 * - SettingsPanel 组件交互（主题/语言选择、数值提交夹紧、重置 FR-12.7）。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  applySettingsEffects,
  applyTheme,
  loadSettings,
  saveSettings,
  sanitizeSettings,
  type AppSettings,
} from '../src/features/settings/settings';
import {
  clearThumbnails,
  getThumbnailMaxCount,
  setThumbnailMaxCount,
} from '../src/features/series/thumbnails';
import { SettingsPanel } from '../src/ui/components/SettingsPanel';
import { I18nProvider } from '../src/ui/i18n/i18n';

beforeEach(() => {
  localStorage.clear();
  clearThumbnails();
  setThumbnailMaxCount(100);
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
});

describe('sanitizeSettings（非法输入 → 合法设置）', () => {
  it('空/非对象输入 → 全部默认值', () => {
    expect(sanitizeSettings(undefined)).toEqual({ ...DEFAULT_SETTINGS });
    expect(sanitizeSettings('garbage')).toEqual({ ...DEFAULT_SETTINGS });
    expect(sanitizeSettings(null)).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('逐字段回退 + 范围夹紧', () => {
    expect(
      sanitizeSettings({
        theme: 'light',
        language: 'en',
        maxImageCacheMb: 999999,
        thumbnailMaxCount: 2,
      }),
    ).toEqual({ theme: 'light', language: 'en', maxImageCacheMb: 4096, thumbnailMaxCount: 10 });
    expect(sanitizeSettings({ theme: 'x', language: 'fr' })).toMatchObject({
      theme: 'dark',
      language: 'zh',
    });
  });
});

describe('loadSettings / saveSettings（localStorage 持久化）', () => {
  it('无存储 → 默认值', () => {
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('保存后读取往返一致', () => {
    const settings: AppSettings = {
      theme: 'light',
      language: 'en',
      maxImageCacheMb: 512,
      thumbnailMaxCount: 200,
    };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"language":"en"');
  });

  it('损坏的 JSON → 回退默认（不抛错）', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not-json');
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS });
  });
});

describe('applyTheme / applySettingsEffects（副作用调用链）', () => {
  it('主题落到 <html data-theme>', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('缓存上限 MB→字节；缩略图上限写入注入回调', () => {
    const setMaxCacheSize = vi.fn();
    const setThumbnailLimit = vi.fn();
    applySettingsEffects(
      { theme: 'dark', language: 'zh', maxImageCacheMb: 256, thumbnailMaxCount: 50 },
      { cacheApi: { setMaxCacheSize }, setThumbnailLimit },
    );
    expect(setMaxCacheSize).toHaveBeenCalledWith(256 * 1024 * 1024);
    expect(setThumbnailLimit).toHaveBeenCalledWith(50);
  });

  it('未注入 cacheApi 时不触碰 Cornerstone（管线未初始化安全）', () => {
    expect(() =>
      applySettingsEffects(
        { theme: 'dark', language: 'zh', maxImageCacheMb: 256, thumbnailMaxCount: 50 },
        {},
      ),
    ).not.toThrow();
  });

  it('真实链路：applySettingsEffects 更新缩略图 LRU 上限', () => {
    applySettingsEffects(
      { theme: 'dark', language: 'zh', maxImageCacheMb: 256, thumbnailMaxCount: 30 },
      { setThumbnailLimit: setThumbnailMaxCount },
    );
    expect(getThumbnailMaxCount()).toBe(30);
  });
});

describe('SettingsPanel（组件）', () => {
  function renderPanel(props: Partial<Parameters<typeof SettingsPanel>[0]> = {}) {
    const onChange = props.onChange ?? vi.fn();
    const view = render(
      <I18nProvider>
        <SettingsPanel
          settings={props.settings ?? { ...DEFAULT_SETTINGS }}
          onChange={onChange}
          onClose={props.onClose ?? vi.fn()}
        />
      </I18nProvider>,
    );
    return { ...view, onChange };
  }

  it('渲染主题/语言/缓存上限控件与重置按钮', () => {
    renderPanel();
    expect(screen.getByRole('dialog', { name: '设置' })).not.toBeNull();
    expect(screen.getByLabelText('主题')).not.toBeNull();
    expect(screen.getByLabelText('语言')).not.toBeNull();
    expect(screen.getByLabelText('图像缓存上限（MB）')).not.toBeNull();
    expect(screen.getByLabelText('缩略图缓存上限（条）')).not.toBeNull();
    expect(screen.getByRole('button', { name: '恢复默认设置' })).not.toBeNull();
  });

  it('切换主题/语言 → onChange 收到对应 patch', () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'light' } });
    expect(onChange).toHaveBeenLastCalledWith({ theme: 'light' });
    fireEvent.change(screen.getByLabelText('语言'), { target: { value: 'en' } });
    expect(onChange).toHaveBeenLastCalledWith({ language: 'en' });
  });

  it('数值输入非法值失焦时按 sanitize 夹紧后提交', () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    const cacheInput = screen.getByLabelText('图像缓存上限（MB）') as HTMLInputElement;
    fireEvent.change(cacheInput, { target: { value: '999999' } });
    fireEvent.blur(cacheInput);
    expect(onChange).toHaveBeenCalledWith({
      theme: 'dark',
      language: 'zh',
      maxImageCacheMb: 4096,
      thumbnailMaxCount: 100,
    });
    expect(cacheInput.value).toBe('4096');
  });

  it('重置（FR-12.7）→ onChange 收到默认设置', () => {
    const onChange = vi.fn();
    renderPanel({
      onChange,
      settings: { theme: 'light', language: 'en', maxImageCacheMb: 512, thumbnailMaxCount: 200 },
    });
    fireEvent.click(screen.getByRole('button', { name: '恢复默认设置' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS });
  });

  it('关闭按钮回调 onClose', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
