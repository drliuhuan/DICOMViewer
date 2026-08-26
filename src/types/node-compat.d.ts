/**
 * 最小 Node 内置模块类型垫片（仅测试使用）。
 *
 * 本项目未安装 @types/node（构建链只面向浏览器）；m9.pwaIcons.test.ts
 * 需在 node 环境读取 public/ 下的 PNG/manifest 字节，此处仅声明用到的
 * 签名，避免为单测引入重量级 @types/node。
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}
