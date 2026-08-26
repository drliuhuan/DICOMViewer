/**
 * M9 移动端文件打开能力检测（FR-14.3/AC-29）：
 * - 平台判定（iPhone/iPadOS 伪装 Mac/Android/桌面）；
 * - 能力矩阵：iOS 无文件夹选择 → supportsFolder=false 且携带引导文案；
 *   Android/桌面 supportsFolder=true；多选文件全平台可用。
 */
import { describe, expect, it } from 'vitest';
import {
  detectMobileFileAccess,
  detectMobilePlatform,
} from '../src/features/loading/mobileFileAccess';

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_IPAD_CLASSIC =
  'Mozilla/5.0 (iPad; CPU OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1';
const UA_IPADOS_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('detectMobilePlatform（UA + maxTouchPoints 判定）', () => {
  it('iPhone → ios', () => {
    expect(detectMobilePlatform(UA_IPHONE)).toBe('ios');
  });

  it('经典 iPad UA → ios', () => {
    expect(detectMobilePlatform(UA_IPAD_CLASSIC)).toBe('ios');
  });

  it('iPadOS 伪装 Macintosh：maxTouchPoints>1 兜底识别为 ios', () => {
    expect(detectMobilePlatform(UA_IPADOS_AS_MAC, 5)).toBe('ios');
  });

  it('Macintosh 但无触屏（真实桌面 Mac）→ desktop', () => {
    expect(detectMobilePlatform(UA_IPADOS_AS_MAC, 0)).toBe('desktop');
  });

  it('Android Chrome → android', () => {
    expect(detectMobilePlatform(UA_ANDROID)).toBe('android');
  });

  it('桌面 Chrome → desktop；空 UA → desktop', () => {
    expect(detectMobilePlatform(UA_DESKTOP)).toBe('desktop');
    expect(detectMobilePlatform('')).toBe('desktop');
  });
});

describe('detectMobileFileAccess（能力矩阵）', () => {
  it('iOS：无文件夹选择能力，提供多选文件 + PACS/URL 引导文案', () => {
    const access = detectMobileFileAccess(UA_IPHONE);
    expect(access.platform).toBe('ios');
    expect(access.supportsFolder).toBe(false);
    expect(access.supportsMultipleFiles).toBe(true);
    expect(access.missingFolderHint).toContain('PACS');
  });

  it('iPadOS（Mac 伪装 + 触屏）同样无文件夹能力', () => {
    expect(detectMobileFileAccess(UA_IPADOS_AS_MAC, 5).supportsFolder).toBe(false);
  });

  it('Android：文件夹选择与桌面等价（webkitdirectory）', () => {
    const access = detectMobileFileAccess(UA_ANDROID);
    expect(access.platform).toBe('android');
    expect(access.supportsFolder).toBe(true);
    expect(access.missingFolderHint).toBeNull();
  });

  it('桌面：全能力', () => {
    const access = detectMobileFileAccess(UA_DESKTOP);
    expect(access.supportsFolder).toBe(true);
    expect(access.supportsMultipleFiles).toBe(true);
    expect(access.missingFolderHint).toBeNull();
  });
});
