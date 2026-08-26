/**
 * M9 移动端性能自适应（FR-14.4/AC-30）：
 * - 设备画像判定：deviceMemory 提供时按 ≤4GB 判低内存；
 *   未提供时（iOS Safari）移动端按低内存、桌面端不降级；
 * - 低内存降级：缩略图上限减半、图像缓存 1/4（NFR-4），
 *   且不低于合法下限；非低内存设备原样返回。
 */
import { describe, expect, it } from 'vitest';
import {
  LOW_MEMORY_GB_THRESHOLD,
  adaptSettingsForDevice,
  detectDeviceProfile,
  type DeviceProfile,
} from '../src/features/perf/deviceProfile';
import type { AppSettings } from '../src/features/settings/settings';

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36';

const BASE_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'zh',
  maxImageCacheMb: 256,
  thumbnailMaxCount: 100,
};

describe('detectDeviceProfile（设备画像判定）', () => {
  it('deviceMemory 提供：≤ 阈值（4GB）判低内存', () => {
    expect(LOW_MEMORY_GB_THRESHOLD).toBe(4);
    expect(detectDeviceProfile({ userAgent: UA_ANDROID, deviceMemory: 4 }).lowMemory).toBe(true);
    expect(detectDeviceProfile({ userAgent: UA_ANDROID, deviceMemory: 3 }).lowMemory).toBe(true);
  });

  it('deviceMemory 提供：> 阈值不判低内存（平板/高端机）', () => {
    expect(detectDeviceProfile({ userAgent: UA_ANDROID, deviceMemory: 8 }).lowMemory).toBe(false);
    expect(
      detectDeviceProfile({ userAgent: UA_DESKTOP, deviceMemory: 16 }),
    ).toMatchObject({ platform: 'desktop', lowMemory: false });
  });

  it('deviceMemory 缺失（iOS Safari）：移动端按低内存处理', () => {
    const profile = detectDeviceProfile({ userAgent: UA_IPHONE });
    expect(profile).toMatchObject({ platform: 'ios', deviceMemoryGb: null, lowMemory: true });
  });

  it('deviceMemory 缺失：桌面端不降级（保持默认）', () => {
    const profile = detectDeviceProfile({ userAgent: UA_DESKTOP });
    expect(profile).toMatchObject({ platform: 'desktop', deviceMemoryGb: null, lowMemory: false });
  });

  it('非法 deviceMemory（NaN/0/负数）按未提供处理', () => {
    expect(detectDeviceProfile({ userAgent: UA_ANDROID, deviceMemory: Number.NaN })).toMatchObject(
      { deviceMemoryGb: null, lowMemory: true },
    );
    expect(detectDeviceProfile({ userAgent: UA_ANDROID, deviceMemory: 0 })).toMatchObject({
      deviceMemoryGb: null,
      lowMemory: true,
    });
    expect(
      detectDeviceProfile({ userAgent: UA_DESKTOP, deviceMemory: -1 }),
    ).toMatchObject({ deviceMemoryGb: null, lowMemory: false });
  });

  it('空输入（node 单测环境）：desktop 且不降级', () => {
    expect(detectDeviceProfile()).toMatchObject({
      platform: 'desktop',
      deviceMemoryGb: null,
      lowMemory: false,
    });
  });
});

describe('adaptSettingsForDevice（低内存降级）', () => {
  const lowProfile: DeviceProfile = { platform: 'ios', deviceMemoryGb: null, lowMemory: true };
  const highProfile: DeviceProfile = { platform: 'desktop', deviceMemoryGb: 16, lowMemory: false };

  it('低内存：缩略图上限减半、图像缓存 1/4（向下取整）', () => {
    expect(adaptSettingsForDevice(BASE_SETTINGS, lowProfile)).toEqual({
      ...BASE_SETTINGS,
      thumbnailMaxCount: 50,
      maxImageCacheMb: 64,
    });
  });

  it('低内存：奇数上限减半向下取整；缓存低于下限时钳到 CACHE_MB_MIN(64)', () => {
    expect(
      adaptSettingsForDevice(
        { ...BASE_SETTINGS, thumbnailMaxCount: 101, maxImageCacheMb: 128 },
        lowProfile,
      ),
    ).toMatchObject({ thumbnailMaxCount: 50, maxImageCacheMb: 64 });
  });

  it('低内存：缩略图下限 1（用户设置极小值不再低于 1）', () => {
    expect(
      adaptSettingsForDevice({ ...BASE_SETTINGS, thumbnailMaxCount: 1 }, lowProfile).thumbnailMaxCount,
    ).toBe(1);
  });

  it('非低内存：原样返回同一引用（无副作用）', () => {
    const adapted = adaptSettingsForDevice(BASE_SETTINGS, highProfile);
    expect(adapted).toBe(BASE_SETTINGS);
  });

  it('降级值仅运行时生效：与用户设置相互独立（重复降级不叠加）', () => {
    const once = adaptSettingsForDevice(BASE_SETTINGS, lowProfile);
    // 以「用户原始设置」为基准降级（App 侧语义），而非在已降级值上再降
    const again = adaptSettingsForDevice(BASE_SETTINGS, lowProfile);
    expect(again).toEqual(once);
    expect(again.thumbnailMaxCount).toBe(50); // 而非 25
  });
});
