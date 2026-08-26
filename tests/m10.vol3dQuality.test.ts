/**
 * M10-C 3D 渲染质量档位（FR-7.7）与渐进式渲染常量（FR-7.6）：
 * 档位→采样距离倍数、sanitize、标签。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME3D_QUALITY,
  INTERACTION_IDLE_MS,
  INTERACTION_LOW_QUALITY_MULTIPLIER,
  VOLUME3D_QUALITY_LEVELS,
  VOLUME3D_QUALITY_MULTIPLIER,
  qualityMultiplierFor,
  sanitizeVolume3dQuality,
  volume3dQualityLabel,
} from '../src/features/volume3d/quality';

describe('质量档位（FR-7.7）', () => {
  it('三档：低/中/高', () => {
    expect(VOLUME3D_QUALITY_LEVELS).toEqual(['low', 'medium', 'high']);
  });

  it('档位 → 采样距离倍数：低清倍数大、高清倍数小且 > 0', () => {
    const low = qualityMultiplierFor('low');
    const medium = qualityMultiplierFor('medium');
    const high = qualityMultiplierFor('high');
    expect(low).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(high);
    expect(high).toBeGreaterThan(0);
  });

  it('sanitizeVolume3dQuality 回退默认（中）', () => {
    expect(sanitizeVolume3dQuality('high')).toBe('high');
    expect(sanitizeVolume3dQuality('bogus')).toBe(DEFAULT_VOLUME3D_QUALITY);
    expect(sanitizeVolume3dQuality(undefined)).toBe(DEFAULT_VOLUME3D_QUALITY);
  });

  it('中文标签', () => {
    expect(volume3dQualityLabel('low')).toBe('低');
    expect(volume3dQualityLabel('medium')).toBe('中');
    expect(volume3dQualityLabel('high')).toBe('高');
  });
});

describe('渐进式渲染（FR-7.6）', () => {
  it('交互低质量倍数 ≥ 最高档倍数（保证交互帧率先行）', () => {
    expect(INTERACTION_LOW_QUALITY_MULTIPLIER).toBeGreaterThanOrEqual(
      VOLUME3D_QUALITY_MULTIPLIER.high,
    );
    expect(INTERACTION_IDLE_MS).toBeGreaterThan(0);
  });
});