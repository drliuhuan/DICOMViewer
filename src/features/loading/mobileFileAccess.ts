/**
 * 移动端文件打开能力检测（M9，FR-14.3/AC-29）。
 *
 * - Android Chrome：`<input webkitdirectory>` 打开文件夹，与桌面一等路径等价
 *   （App 现有 openFolder 流程直接复用）；
 * - iOS Safari：无文件夹选择能力 → 提供文件多选（`<input multiple>`，
 *   App 现有 file input 已具备）并引导「从 PACS/URL 加载」，
 *   能力差异在打开界面明确提示（missingFolderHint）；
 * - 平台判定以 UA 为主；iPadOS 13+ 默认站点 UA 伪装成 Macintosh，
 *   以 maxTouchPoints>1 兜底识别。
 *
 * TODO(FR-14.3)：iPadOS UA 识别仍可能漏判（如用户切换「请求桌面网站」
 * 且无触屏报告的边缘场景），可再叠加 pointer:coarse 媒体查询。
 */

export type MobilePlatform = 'ios' | 'android' | 'desktop';

export interface MobileFileAccess {
  platform: MobilePlatform;
  /** 文件夹选择能力（iOS 为 false；Android/桌面为 true） */
  supportsFolder: boolean;
  /** 多文件选择能力（input multiple，全平台 true） */
  supportsMultipleFiles: boolean;
  /** 文件夹能力缺失时的引导文案；null = 无需提示 */
  missingFolderHint: string | null;
}

const IOS_UA = /iPhone|iPad|iPod/i;
const ANDROID_UA = /Android/i;
const MAC_UA = /Macintosh/i;

/** UA + 触屏点数判定移动平台（iPadOS 伪装 Mac 时以 maxTouchPoints 兜底） */
export function detectMobilePlatform(
  userAgent: string,
  maxTouchPoints = 0,
): MobilePlatform {
  if (IOS_UA.test(userAgent)) {
    return 'ios';
  }
  if (MAC_UA.test(userAgent) && maxTouchPoints > 1) {
    return 'ios';
  }
  if (ANDROID_UA.test(userAgent)) {
    return 'android';
  }
  return 'desktop';
}

export function detectMobileFileAccess(
  userAgent: string,
  maxTouchPoints = 0,
): MobileFileAccess {
  const platform = detectMobilePlatform(userAgent, maxTouchPoints);
  if (platform === 'ios') {
    return {
      platform,
      supportsFolder: false,
      supportsMultipleFiles: true,
      missingFolderHint: 'iOS 不支持打开文件夹：可多选文件，或从 PACS/URL 加载',
    };
  }
  return {
    platform,
    supportsFolder: true,
    supportsMultipleFiles: true,
    missingFolderHint: null,
  };
}
