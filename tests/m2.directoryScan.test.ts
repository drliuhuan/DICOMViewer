/**
 * M2-A 目录扫描测试（FR-1.2 / FR-1.3）：
 * 以普通对象 mock FileSystemDirectoryHandle 与 webkitGetAsEntry 递归结构，
 * 断言收集文件数与相对路径。
 */
import { describe, expect, it } from 'vitest';
import {
  scanDirectoryHandle,
  scanDroppedItems,
  scanFileSystemEntries,
  supportsDirectoryPicker,
  toScannedFiles,
  type DirectoryHandleLike,
  type EntryLike,
} from '../src/features/loading/directoryScan';

/** 构造内存文件 */
function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name);
}

/** 构造目录句柄：values() 逐个产出子句柄 */
function makeDir(
  name: string,
  children: Array<DirectoryHandleLike | ReturnType<typeof makeFileHandle>>,
): DirectoryHandleLike {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const child of children) {
        yield child;
      }
    },
  };
}

function makeFileHandle(name: string): {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
} {
  return { kind: 'file', name, getFile: () => Promise.resolve(makeFile(name)) };
}

describe('scanDirectoryHandle（showDirectoryPicker 路径）', () => {
  it('递归收集全部子文件夹中的文件并生成相对路径', async () => {
    const root = makeDir('study-root', [
      makeFileHandle('a.dcm'),
      makeDir('sub-1', [makeFileHandle('b.dcm'), makeFileHandle('.DS_Store')]),
      makeDir('sub-2', [makeDir('deep', [makeFileHandle('c.dcm')])]),
    ]);
    const scanned = await scanDirectoryHandle(root);
    expect(scanned).toHaveLength(4);
    expect(scanned.map((s) => s.relativePath)).toEqual([
      'study-root/a.dcm',
      'study-root/sub-1/b.dcm',
      'study-root/sub-1/.DS_Store',
      'study-root/sub-2/deep/c.dcm',
    ]);
    expect(scanned[0]?.file.name).toBe('a.dcm');
  });

  it('空目录返回空数组', async () => {
    const scanned = await scanDirectoryHandle(makeDir('empty', []));
    expect(scanned).toEqual([]);
  });
});

describe('scanFileSystemEntries（webkitGetAsEntry 拖拽路径）', () => {
  /** 文件条目：file(success) 回调交付 File */
  function fileEntry(name: string, fullPath?: string): EntryLike {
    return {
      isFile: true,
      isDirectory: false,
      name,
      fullPath,
      file: (success) => success(makeFile(name)),
    };
  }

  /**
   * 目录条目：readEntries 分页交付（模拟 Chrome 每次 ≤100 条的分页行为，
   * 此处以每页 2 条的小分页验证循环读取直至空批）。
   */
  function dirEntry(name: string, children: EntryLike[]): EntryLike {
    const pages: EntryLike[][] = [];
    for (let i = 0; i < children.length; i += 2) {
      pages.push(children.slice(i, i + 2));
    }
    pages.push([]);
    let page = 0;
    return {
      isFile: false,
      isDirectory: true,
      name,
      fullPath: `/${name}`,
      createReader: () => ({
        readEntries: (success) => {
          const batch = pages[page] ?? [];
          page += 1;
          success(batch);
        },
      }),
    };
  }

  it('递归读取嵌套目录树，相对路径以顶层文件夹名开头', async () => {
    const root = dirEntry('folder', [
      fileEntry('a.dcm', '/folder/a.dcm'),
      dirEntry('inner', [
        fileEntry('b.dcm', '/folder/inner/b.dcm'),
        fileEntry('c.txt', '/folder/inner/c.txt'),
        fileEntry('d.dcm', '/folder/inner/d.dcm'),
        fileEntry('e.dcm', '/folder/inner/e.dcm'),
      ]),
    ]);
    const scanned = await scanFileSystemEntries([root]);
    expect(scanned).toHaveLength(5);
    expect(scanned.map((s) => s.relativePath)).toEqual([
      'folder/a.dcm',
      'folder/inner/b.dcm',
      'folder/inner/c.txt',
      'folder/inner/d.dcm',
      'folder/inner/e.dcm',
    ]);
  });

  it('缺失 fullPath 时回退为条目名', async () => {
    const scanned = await scanFileSystemEntries([fileEntry('lone.dcm')]);
    expect(scanned[0]?.relativePath).toBe('lone.dcm');
  });

  it('混合文件与目录条目均可收集', async () => {
    const scanned = await scanFileSystemEntries([
      fileEntry('top.dcm', '/top.dcm'),
      dirEntry('d', [fileEntry('n.dcm', '/d/n.dcm')]),
    ]);
    expect(scanned.map((s) => s.relativePath)).toEqual(['top.dcm', 'd/n.dcm']);
  });
});

describe('toScannedFiles（webkitdirectory 输入框路径）', () => {
  it('优先使用 webkitRelativePath，缺失时回退文件名', () => {
    const withPath = Object.assign(makeFile('a.dcm'), {
      webkitRelativePath: 'root/sub/a.dcm',
    }) as File & { webkitRelativePath?: string };
    const withoutPath = makeFile('b.dcm');
    const scanned = toScannedFiles([withPath as File, withoutPath]);
    expect(scanned.map((s) => s.relativePath)).toEqual(['root/sub/a.dcm', 'b.dcm']);
  });
});

describe('scanDroppedItems（窗口拖拽入口）', () => {
  it('支持条目 API 时递归收集文件夹内容', async () => {
    const entry: EntryLike = {
      isFile: true,
      isDirectory: false,
      name: 'a.dcm',
      fullPath: '/drop/a.dcm',
      file: (success) => success(makeFile('a.dcm')),
    };
    const result = await scanDroppedItems({
      files: [],
      items: [{ kind: 'file', webkitGetAsEntry: () => entry }],
    });
    expect(result.needsPickerFallback).toBe(false);
    expect(result.files.map((f) => f.relativePath)).toEqual(['a.dcm']);
  });

  it('无 items 时退回 dataTransfer.files（普通多文件拖拽）', async () => {
    const f = makeFile('plain.dcm');
    const result = await scanDroppedItems({ files: [f] });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.relativePath).toBe('plain.dcm');
    expect(result.needsPickerFallback).toBe(false);
  });

  it('不支持条目 API 且拿不到任何文件时判定为疑似文件夹 → 引导按钮入口', async () => {
    const result = await scanDroppedItems({
      files: [],
      items: [{ kind: 'file' }],
    });
    expect(result.needsPickerFallback).toBe(true);
  });

  it('webkitGetAsEntry 全部返回 null 时退回 files 列表', async () => {
    const f = makeFile('x.dcm');
    const result = await scanDroppedItems({
      files: [f],
      items: [{ kind: 'file', webkitGetAsEntry: () => null }],
    });
    expect(result.files).toHaveLength(1);
    expect(result.needsPickerFallback).toBe(false);
  });
});

describe('supportsDirectoryPicker', () => {
  it('Node 测试环境（无浏览器 showDirectoryPicker）返回 false', () => {
    expect(supportsDirectoryPicker()).toBe(false);
  });
});
