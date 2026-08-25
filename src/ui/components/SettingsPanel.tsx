/**
 * 设置面板（FR-12 子集：主题/语言/图像缓存上限/缩略图缓存上限/重置）。
 * 从简实现：工具栏下拉卡片，复用现有 .tool-button / 表单样式。
 * 数值输入允许中间态，失焦/回车时提交，非法值由 sanitizeSettings 夹紧。
 */
import { useState } from 'react';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type AppSettings,
  type ThemeMode,
} from '../../features/settings/settings';
import type { Lang } from '../i18n/i18n';
import { useT } from '../i18n/i18n';

interface SettingsPanelProps {
  settings: AppSettings;
  /** 变更已 sanitize 的部分设置（App 负责持久化 + 应用副作用） */
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
}

/** 由父组件条件挂载（关闭即卸载，数值草稿随之重置） */
export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const { t } = useT();
  const [cacheDraft, setCacheDraft] = useState(String(settings.maxImageCacheMb));
  const [thumbDraft, setThumbDraft] = useState(String(settings.thumbnailMaxCount));

  const commitNumbers = (): void => {
    const next = sanitizeSettings({
      ...settings,
      maxImageCacheMb: Number(cacheDraft),
      thumbnailMaxCount: Number(thumbDraft),
    });
    setCacheDraft(String(next.maxImageCacheMb));
    setThumbDraft(String(next.thumbnailMaxCount));
    onChange(next);
  };

  return (
    <div className="settings-panel" role="dialog" aria-label={t('settings.title')}>
      <div className="settings-panel-header">
        <span>{t('settings.title')}</span>
        <button
          type="button"
          className="tool-button"
          aria-label={t('settings.close')}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <label className="settings-field">
        <span>{t('settings.theme')}</span>
        <select
          value={settings.theme}
          onChange={(event) => onChange({ theme: event.target.value as ThemeMode })}
          aria-label={t('settings.theme')}
        >
          <option value="dark">{t('settings.theme.dark')}</option>
          <option value="light">{t('settings.theme.light')}</option>
        </select>
      </label>

      <label className="settings-field">
        <span>{t('settings.language')}</span>
        <select
          value={settings.language}
          onChange={(event) => onChange({ language: event.target.value as Lang })}
          aria-label={t('settings.language')}
        >
          <option value="zh">{t('settings.language.zh')}</option>
          <option value="en">{t('settings.language.en')}</option>
        </select>
      </label>

      <label className="settings-field">
        <span>{t('settings.imageCache')}</span>
        <input
          type="number"
          className="settings-number"
          value={cacheDraft}
          min={64}
          max={4096}
          step={64}
          onChange={(event) => setCacheDraft(event.target.value)}
          onBlur={commitNumbers}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitNumbers();
            }
          }}
          aria-label={t('settings.imageCache')}
        />
      </label>

      <label className="settings-field">
        <span>{t('settings.thumbCache')}</span>
        <input
          type="number"
          className="settings-number"
          value={thumbDraft}
          min={10}
          max={500}
          step={10}
          onChange={(event) => setThumbDraft(event.target.value)}
          onBlur={commitNumbers}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitNumbers();
            }
          }}
          aria-label={t('settings.thumbCache')}
        />
      </label>

      <button
        type="button"
        className="tool-button settings-reset"
        onClick={() => {
          setCacheDraft(String(DEFAULT_SETTINGS.maxImageCacheMb));
          setThumbDraft(String(DEFAULT_SETTINGS.thumbnailMaxCount));
          onChange({ ...DEFAULT_SETTINGS });
        }}
      >
        {t('settings.reset')}
      </button>
    </div>
  );
}
