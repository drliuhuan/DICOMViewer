/**
 * 3D 渲染质量档位与渐进式渲染（FR-7.7 / FR-7.6，M10-C）。
 *
 * - 质量档位：低/中/高三档，映射到 vtk 容积采样距离倍数
 *   （VolumeViewport3D.setSampleDistanceMultiplier，越大越低清）；
 * - 渐进式渲染：交互（相机/窗宽窗位变化）时切到低质量保证帧率，
 *   静止 INTERACTION_IDLE_MS 后恢复到当前质量档位所选倍数。
 *
 * 全部纯函数，可在 Node 下单元测试。
 */

/** 交互停止后恢复到目标质量的延迟（ms） */
export const INTERACTION_IDLE_MS = 450;

/** 交互进行时的低质量采样距离倍数 */
export const INTERACTION_LOW_QUALITY_MULTIPLIER = 4;

export type Volume3dQualityLevel = 'low' | 'medium' | 'high';

export const VOLUME3D_QUALITY_LEVELS: readonly Volume3dQualityLevel[] = [
  'low',
  'medium',
  'high',
];

/** 各质量档位 → vtk 采样距离倍数（低清更快，高清吃 GPU） */
export const VOLUME3D_QUALITY_MULTIPLIER: Readonly<
  Record<Volume3dQualityLevel, number>
> = Object.freeze({
  low: 3,
  medium: 1.2,
  high: 0.7,
});

export const DEFAULT_VOLUME3D_QUALITY: Volume3dQualityLevel = 'medium';

/** 任意输入 → 合法质量档位（回退默认） */
export function sanitizeVolume3dQuality(
  input: unknown,
): Volume3dQualityLevel {
  return VOLUME3D_QUALITY_LEVELS.includes(input as Volume3dQualityLevel)
    ? (input as Volume3dQualityLevel)
    : DEFAULT_VOLUME3D_QUALITY;
}

/** 质量档位 → 采样距离倍数 */
export function qualityMultiplierFor(level: Volume3dQualityLevel): number {
  return VOLUME3D_QUALITY_MULTIPLIER[level];
}

/** 质量档位简体中文标签 */
export function volume3dQualityLabel(level: Volume3dQualityLevel): string {
  switch (level) {
    case 'low':
      return '低';
    case 'medium':
      return '中';
    case 'high':
      return '高';
  }
}