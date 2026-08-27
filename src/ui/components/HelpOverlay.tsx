/**
 * 快捷键速查浮层（FR-11 要求：应用内提供快捷键速查表入口）。
 * 纯展示组件：数据来自 SHORTCUT_TABLE（与 resolveShortcut 的键位保持一致），
 * Esc / 遮罩点击 / 关闭按钮均可关闭。
 */
import { useEffect } from 'react';
import { useT } from '../i18n/i18n';
import { IconClose } from '../icons';

export interface ShortcutRow {
  /** 按键（展示用） */
  keys: string;
  /** 功能描述 i18n 键 */
  labelKey: string;
}

/** 快捷键表（与 src/features/shortcuts/shortcuts.ts 的键位一一对应） */
export const SHORTCUT_TABLE: readonly ShortcutRow[] = [
  { keys: 'I', labelKey: 'help.row.info' },
  { keys: 'W', labelKey: 'help.row.windowLevel' },
  { keys: 'P', labelKey: 'help.row.pan' },
  { keys: 'Z', labelKey: 'help.row.zoom' },
  { keys: 'L / A / R / O', labelKey: 'help.row.measure' },
  { keys: '+ / −', labelKey: 'help.row.zoomKeys' },
  { keys: '1 / 2 / 4', labelKey: 'help.row.layout' },
  { keys: 'PageUp / PageDown / ← / →', labelKey: 'help.row.slice' },
  { keys: 'F', labelKey: 'help.row.fit' },
  { keys: 'Shift+R', labelKey: 'help.row.reset' },
  { keys: 'Space', labelKey: 'help.row.cine' },
  { keys: 'C', labelKey: 'help.row.crosshair' },
  { keys: 'Delete', labelKey: 'help.row.delete' },
  { keys: 'Esc', labelKey: 'help.row.esc' },
];

interface HelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function HelpOverlay({ open, onClose }: HelpOverlayProps) {
  const { t } = useT();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={t('help.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="help-overlay-header">
          <span>{t('help.title')}</span>
          <button
            type="button"
            className="tool-button"
            aria-label={t('help.close')}
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>
        <table className="help-table">
          <thead>
            <tr>
              <th>{t('help.keys')}</th>
              <th>{t('help.action')}</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_TABLE.map((row) => (
              <tr key={row.labelKey}>
                <td className="help-keys">{row.keys}</td>
                <td>{t(row.labelKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
