/**
 * DICOM 候选文件预筛（FR-1.4，M2-B）。
 *
 * 策略：黑名单制——`.dcm`/`.dicom` 及无扩展名文件必然尝试解析；
 * 明确排除图像/文本/音视频等常见非 DICOM 扩展名以跳过读取，为大文件夹提速；
 * 其余未知扩展名（如 Siemens 的 `.ima`、`.MR`）一律放行交给解析器判定。
 * 扩展名比较大小写不敏感。
 */

/** 常见非 DICOM 扩展名（小写；不含点） */
export const NON_DICOM_EXTENSIONS: ReadonlySet<string> = new Set([
  // 图像
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
  // 视频/音频
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wmv',
  'flv',
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  // 文档/文本
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'rtf',
  'csv',
  'html',
  'htm',
  'xml',
  'json',
  // 脚本/代码
  'js',
  'mjs',
  'ts',
  'tsx',
  'jsx',
  'css',
  'py',
  'java',
  'sh',
  'bat',
  'ps1',
  // 压缩包/磁盘镜像
  'zip',
  'rar',
  '7z',
  'gz',
  'bz2',
  'xz',
  'tar',
  'iso',
  'dmg',
  // 可执行/库
  'exe',
  'dll',
  'so',
  'dylib',
  'apk',
  'msi',
  'bin',
]);

/** 取小写扩展名（不含点）；无扩展名返回 undefined。隐藏文件（.DS_Store）视为无扩展名。 */
function lowerExtension(fileName: string): string | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIndex = base.lastIndexOf('.');
  // 无点、点在首位（隐藏文件）或点在末尾 → 无有效扩展名
  if (dotIndex <= 0 || dotIndex === base.length - 1) {
    return undefined;
  }
  return base.slice(dotIndex + 1).toLowerCase();
}

/**
 * 该文件名是否值得尝试 DICOM 解析。
 * 无扩展名 / .dcm / .dicom / 未知扩展名 → true；命中非 DICOM 黑名单 → false。
 */
export function isLikelyDicomFileName(fileName: string): boolean {
  const ext = lowerExtension(fileName);
  return ext === undefined || !NON_DICOM_EXTENSIONS.has(ext);
}
