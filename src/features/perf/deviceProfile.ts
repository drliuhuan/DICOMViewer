/**
 * 移动端性能自适应（M9，FR-14.4/AC-30）。
 *
 * 启动时检测设备内存，低内存设备主动降级缓存上限：
 * - 数据源 navigator.deviceMemory（仅 Chromium 提供，GB 粒度）；
 *   iOS Safari 不提供 → 移动端无内存信息时按低内存处理（iOS 内存限制严格，
 *   需求清单已识别为风险）；桌面端无内存信息时保持默认（不降级）；
 * - 低内存阈值：≤ 4GB（覆盖中端及以下手机）；
 * - 降级规则：缩略图 LRU 上限减半、Cornerstone 图像缓存上限降至 1/4（NFR-4），
 *   且不低于各自合法下限（缩略图 ≥1、图像缓存 ≥ CACHE_MB_MIN）。
 *
 * 降级值仅在运行时生效（不落 localStorage），用户设置面板的原始值保留。
 *
 * TODO(FR-14.4)：默认低画质档位、大体积序列懒加载+分批拉取、
 * 内存吃紧提示（建议关闭其他标签页）——P1，本阶段未实现。
 */
import { CACHE_MB_MIN, type AppSettings } from '../settings/settings';
import {
  detectMobilePlatform,
  type MobilePlatform,
} from '../loading/mobileFileAccess';

export interface DeviceProfile {
  platform: MobilePlatform;
  /** deviceMemory（GB）；null = 浏览器未提供 */
  deviceMemoryGb: number | null;
  lowMemory: boolean;
}

/** 低内存判定阈值（GB） */
export const LOW_MEMORY_GB_THRESHOLD = 4;

export interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
}

export function detectDeviceProfile(navigatorLike: NavigatorLike = {}): DeviceProfile {
  const platform = detectMobilePlatform(
    navigatorLike.userAgent ?? '',
    navigatorLike.maxTouchPoints ?? 0,
  );
  const rawMemory = navigatorLike.deviceMemory;
  const deviceMemoryGb =
    typeof rawMemory === 'number' && Number.isFinite(rawMemory) && rawMemory > 0
      ? rawMemory
      : null;
  const lowMemory =
    deviceMemoryGb !== null
      ? deviceMemoryGb <= LOW_MEMORY_GB_THRESHOLD
      : platform !== 'desktop';
  return { platform, deviceMemoryGb, lowMemory };
}

/**
 * 低内存设备降级后的设置（纯函数）：
 * 缩略图上限减半、图像缓存 1/4；非低内存设备原样返回（同一引用）。
 */
export function adaptSettingsForDevice(
  settings: AppSettings,
  profile: DeviceProfile,
): AppSettings {
  if (!profile.lowMemory) {
    return settings;
  }
  return {
    ...settings,
    thumbnailMaxCount: Math.max(1, Math.floor(settings.thumbnailMaxCount / 2)),
    maxImageCacheMb: Math.max(CACHE_MB_MIN, Math.floor(settings.maxImageCacheMb / 4)),
  };
}
