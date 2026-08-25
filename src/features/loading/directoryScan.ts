/**
 * 目录扫描与文件收集（FR-1.2 / FR-1.3，M2-A）。
 *
 * 三条入口统一产出 `{ file, relativePath }`：
 * - Chromium `showDirectoryPicker()` → scanDirectoryHandle（File System Access API）；
 * - `<input webkitdirectory>` → toScannedFiles（File 自带 webkitRelativePath）；
 * - 窗口拖拽 → scanDroppedItems（DataTransferItem.webkitGetAsEntry 递归读取目录树，
 *   浏览器不支持时返回 needsPickerFallback 引导用户改用按钮入口）。
 *
 * 本模块刻意使用最小结构化接口（而非 DOM 全局类型），便于在 Node/Vitest
 * 下以普通对象 mock 递归目录树进行单元测试。
 */

/** 扫描得到的单个候选文件 */
export interface ScannedFile {
  file: File;
  /** 相对路径（含文件名），如「folder/sub/a.dcm」；单文件打开时等于 file.name */
  relativePath: string;
}

/** File System Access API 文件句柄的最小结构（与 lib.dom 的 FileSystemFileHandle 兼容） */
export interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

/** File System Access API 目录句柄的最小结构（values() 为标准异步迭代器） */
export interface DirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/**
 * 递归遍历目录句柄树，收集全部文件。
 * @param root 根目录句柄
 * @param parentPath 内部递归用相对路径前缀（调用方不传）
 */
export async function scanDirectoryHandle(
  root: DirectoryHandleLike,
  parentPath = '',
): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  const rootPath = parentPath || root.name;
  for await (const handle of root.values()) {
    if (handle.kind === 'file') {
      const file = await (handle as FileHandleLike).getFile();
      out.push({ file, relativePath: joinPath(rootPath, handle.name) });
    } else {
      const nested = await scanDirectoryHandle(
        handle as DirectoryHandleLike,
        joinPath(rootPath, handle.name),
      );
      out.push(...nested);
    }
  }
  return out;
}

/** webkitGetAsEntry 返回的文件系统条目最小结构（File System Entry API） */
export interface EntryLike {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  /** 相对根的完整路径（如「/folder/a.dcm」）；部分实现缺失 */
  readonly fullPath?: string;
  /** 仅文件条目提供 */
  file?: (
    successCallback: (file: File) => void,
    errorCallback?: (error: unknown) => void,
  ) => void;
  /** 仅目录条目提供；readEntries 单次最多返回 100 条，须循环调用直至空数组 */
  createReader?: () => {
    readEntries(
      successCallback: (entries: EntryLike[]) => void,
      errorCallback?: (error: unknown) => void,
    ): void;
  };
}

/** readEntries 回调式分页读取包装为 Promise（读满整个目录为止） */
function readAllEntries(entry: EntryLike): Promise<EntryLike[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) {
      resolve([]);
      return;
    }
    const all: EntryLike[] = [];
    const readNext = (): void => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readNext();
        },
        (error) => reject(error instanceof Error ? error : new Error(String(error))),
      );
    };
    readNext();
  });
}

/** 条目携带的 File 包装为 Promise */
function entryToFile(entry: EntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file?.(
      (file) => resolve(file),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

/** 递归遍历拖拽条目树，收集全部文件。相对路径由目录结构逐层拼接（不依赖可选的 fullPath）。 */
export async function scanFileSystemEntries(
  entries: readonly EntryLike[],
): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  const walk = async (batch: readonly EntryLike[], prefix: string): Promise<void> => {
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await entryToFile(entry);
        out.push({ file, relativePath: joinPath(prefix, entry.name) });
      } else if (entry.isDirectory) {
        const children = await readAllEntries(entry);
        await walk(children, joinPath(prefix, entry.name));
      }
    }
  };
  await walk(entries, '');
  return out;
}

/** 拖拽数据传输项的最小结构 */
export interface DataTransferItemLike {
  readonly kind: string;
  webkitGetAsEntry?(): EntryLike | null;
}

/** 拖拽扫描输入的最小结构（与 DOM DataTransfer 结构兼容） */
export interface DropScanInput {
  readonly files: ArrayLike<File>;
  readonly items?: ArrayLike<DataTransferItemLike> | null;
}

export interface DropScanResult {
  files: ScannedFile[];
  /**
   * true = 当前浏览器不支持目录条目读取且疑似拖入了文件夹
   * （有 items 但既取不到条目也拿不到文件），应引导用户使用「打开文件夹」按钮。
   */
  needsPickerFallback: boolean;
}

/** 普通文件列表 → 扫描结果（webkitRelativePath 由浏览器在 webkitdirectory 选择时填充） */
export function toScannedFiles(files: readonly File[]): ScannedFile[] {
  return files.map((file) => ({
    file,
    relativePath:
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

/**
 * 扫描窗口拖拽内容：优先 webkitGetAsEntry 递归读取（支持文件夹），
 * 否则退回 dataTransfer.files（普通多文件拖拽）；
 * 无法识别且疑似文件夹时置 needsPickerFallback。
 */
export async function scanDroppedItems(dataTransfer: DropScanInput | null): Promise<DropScanResult> {
  const items = dataTransfer?.items;
  if (!items || items.length === 0) {
    return { files: toScannedFiles(Array.from(dataTransfer?.files ?? [])), needsPickerFallback: false };
  }

  let entrySupported = false;
  const entries: EntryLike[] = [];
  for (const item of Array.from(items)) {
    if (typeof item.webkitGetAsEntry !== 'function') {
      continue;
    }
    entrySupported = true;
    const entry = item.webkitGetAsEntry.call(item);
    if (entry) {
      entries.push(entry);
    }
  }

  if (!entrySupported) {
    const files = Array.from(dataTransfer?.files ?? []);
    // 取不到条目也没有文件 → 大概率是浏览器不支持读取拖入的文件夹
    return { files: toScannedFiles(files), needsPickerFallback: files.length === 0 };
  }
  if (entries.length === 0) {
    return { files: toScannedFiles(Array.from(dataTransfer?.files ?? [])), needsPickerFallback: false };
  }
  const files = await scanFileSystemEntries(entries);
  return { files, needsPickerFallback: false };
}

/** 是否支持 File System Access 的目录选择器（Chromium 系） */
export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}
