/**
 * 英文文案字典（骨架，FR-12.3/NFR-9）。
 * 键集与 zh.ts 对齐；TODO(FR-12.3)：存量组件（序列面板/错误报告/视口覆盖等）
 * 文案迁入 i18n 后按需补全此处翻译。
 */
export const EN: Record<string, string> = {
  'app.openFile': 'Open Files',
  'app.openFolder': 'Open Folder',
  'app.info': 'Info',
  'app.help': 'Help',
  'app.settings': 'Settings',
  'app.emptyHint1': 'Drag DICOM files or a whole folder anywhere in this window',
  'app.emptyHint2': 'or use the "Open Files / Open Folder" buttons above',

  'help.title': 'Keyboard Shortcuts',
  'help.keys': 'Key(s)',
  'help.action': 'Action',
  'help.close': 'Close',
  'help.row.info': 'Show/hide info overlay',
  'help.row.windowLevel': 'Window/level tool',
  'help.row.pan': 'Pan tool',
  'help.row.zoom': 'Zoom tool',
  'help.row.measure': 'Measurement tools (coming in a later milestone)',
  'help.row.zoomKeys': 'Zoom in / Zoom out',
  'help.row.layout': 'Switch layout 1x1 / 1x2 / 2x2',
  'help.row.slice': 'Previous / next slice',
  'help.row.fit': 'Fit to window',
  'help.row.reset': 'Reset view',
  'help.row.cine': 'Cine playback (coming in a later milestone)',
  'help.row.crosshair': 'MPR crosshairs (coming in a later milestone)',
  'help.row.delete': 'Delete selected annotation (M3)',
  'help.row.esc': 'Cancel current tool action',

  'settings.title': 'Settings',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.language': 'Language',
  'settings.language.zh': '中文',
  'settings.language.en': 'English',
  'settings.imageCache': 'Image cache limit (MB)',
  'settings.thumbCache': 'Thumbnail cache limit (items)',
  'settings.reset': 'Restore defaults',
  'settings.close': 'Close settings',
};
