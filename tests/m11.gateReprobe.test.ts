/**
 * M11 任务 2：WebGL2 重探工具（refreshWebGL2）纯逻辑单测。
 * Node 环境（无 document）：默认探测返回 false，语义可注入验证。
 */
import { describe, expect, it } from 'vitest';
import { hasWebGL2, refreshWebGL2 } from '../src/features/volume3d/gate';

describe('refreshWebGL2', () => {
  it('已可用时短路返回 true（不再探测）', () => {
    expect(refreshWebGL2(true)).toBe(true);
  });

  it('不可用时重新探测：Node 无画布 → 默认探测仍为 false', () => {
    expect(refreshWebGL2(false)).toBe(false);
  });

  it('hasWebGL2 注入可用 webgl2 上下文桩 → true（重探语义可恢复）', () => {
    const probe = hasWebGL2({
      createCanvas: () =>
        ({ getContext: (type: string) => (type === 'webgl2' ? {} : null) }) as never,
    });
    expect(probe).toBe(true);
  });
});
