/**
 * 中文文案字典（默认语言，FR-12.3/NFR-9）。
 * 值为现有 UI 字符串的逐字迁移，保证默认行为不变。
 */
export const ZH: Record<string, string> = {
  'app.openFile': '打开文件',
  'app.openFolder': '打开文件夹',
  'app.info': '信息',
  'app.help': '帮助',
  'app.settings': '设置',
  'app.emptyHint1': '将 DICOM 文件或整个文件夹拖拽到窗口任意位置',
  'app.emptyHint2': '或点击上方「打开文件 / 打开文件夹」按钮',

  'help.title': '快捷键速查表',
  'help.keys': '按键',
  'help.action': '功能',
  'help.close': '关闭',
  'help.row.info': '显示/隐藏信息覆盖文字',
  'help.row.windowLevel': '窗宽窗位工具',
  'help.row.pan': '平移工具',
  'help.row.zoom': '缩放工具',
  'help.row.measure': '测量工具：L 长度 / A 角度 / R 矩形 ROI / O 椭圆 ROI',
  'help.row.zoomKeys': '放大 / 缩小',
  'help.row.layout': '切换布局 1×1 / 1×2 / 2×2',
  'help.row.slice': '上一帧 / 下一帧',
  'help.row.fit': '适应窗口',
  'help.row.reset': '重置视图',
  'help.row.cine': 'Cine 播放（后续里程碑提供）',
  'help.row.crosshair': 'MPR 定位线（后续里程碑提供）',
  'help.row.delete': '删除选中标注',
  'help.row.esc': '取消当前工具操作',

  'settings.title': '设置',
  'settings.theme': '主题',
  'settings.theme.dark': '深色',
  'settings.theme.light': '浅色',
  'settings.language': '语言',
  'settings.language.zh': '中文',
  'settings.language.en': '英文',
  'settings.imageCache': '图像缓存上限（MB）',
  'settings.thumbCache': '缩略图缓存上限（条）',
  'settings.reset': '恢复默认设置',
  'settings.close': '关闭设置',
};
