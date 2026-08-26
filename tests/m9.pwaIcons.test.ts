/**
 * M9 PWA 移动端复核（FR-14.7/AC-31，M7 已建离线壳，本里程碑补图标）：
 * - PNG 图标（icon-192/512）为合法 PNG（签名 + IHDR 尺寸/位深/颜色类型），
 *   iOS apple-touch-icon 需 PNG（SVG 在旧版 iOS 不渲染）；
 * - manifest 同时列出 SVG 与 192/512 PNG（含 maskable），display=standalone；
 * - index.html：apple-touch-icon 指向 PNG、viewport-fit=cover（安全区前提）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestRaw from '../public/manifest.webmanifest?raw';

const rootDir = dirname(fileURLToPath(import.meta.url));

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** 解析 PNG 前 8（签名）+ IHDR 块（签名后 8 字节长度 + 4 字节类型 + 13 字节数据） */
function parsePngHeader(buffer: Uint8Array): PngHeader {
  expect(bytesEqual(buffer.subarray(0, 8), PNG_SIGNATURE)).toBe(true);
  expect(buffer.length).toBeGreaterThan(33);
  const width = ((buffer[16]! << 24) >>> 0) | (buffer[17]! << 16) | (buffer[18]! << 8) | buffer[19]!;
  const height =
    ((buffer[20]! << 24) >>> 0) | (buffer[21]! << 16) | (buffer[22]! << 8) | buffer[23]!;
  const bitDepth = buffer[24]!;
  const colorType = buffer[25]!;
  return { width, height, bitDepth, colorType };
}

describe('PNG 图标（iOS apple-touch-icon 需要 PNG）', () => {
  it.each([
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ] as const)('%s 为合法 %i×%i RGBA PNG', (fileName, expectedSize) => {
    const buffer = readFileSync(join(rootDir, '../public', fileName));
    const header = parsePngHeader(buffer);
    expect(header.width).toBe(expectedSize);
    expect(header.height).toBe(expectedSize);
    expect(header.bitDepth).toBe(8);
    expect(header.colorType).toBe(6); // RGBA
  });
});

describe('manifest 图标与独立窗口（AC-31）', () => {
  it('display=standalone 且同时提供 SVG 与 192/512 PNG（含 maskable）', () => {
    const manifest = JSON.parse(manifestRaw) as {
      display?: string;
      icons?: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    expect(manifest.display).toBe('standalone');
    const icons = manifest.icons ?? [];
    const bySrc = (src: string) => icons.filter((icon) => icon.src === src);
    expect(bySrc('icon.svg').length).toBeGreaterThanOrEqual(1);
    expect(bySrc('icon-192.png')).toEqual([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
    ]);
    const png512 = bySrc('icon-512.png');
    expect(png512.some((icon) => icon.purpose === 'any')).toBe(true);
    expect(png512.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});

describe('index.html 移动端 PWA 元信息', () => {
  const html = readFileSync(join(rootDir, '../index.html'), 'utf8');

  it('apple-touch-icon 指向 PNG（iOS 主屏图标）', () => {
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*href="\/icon-192\.png"/);
  });

  it('viewport-fit=cover 已启用（安全区 env() 前提）', () => {
    expect(html).toContain('viewport-fit=cover');
  });

  it('iOS 独立窗口元信息齐全', () => {
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-title');
    expect(html).toContain('apple-mobile-web-app-status-bar-style');
  });
});
