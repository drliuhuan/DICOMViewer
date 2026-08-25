/**
 * SOP Instance UID 去重（FR-1.11，M2-E）。
 *
 * 同一实例（同 SOPInstanceUID）跨批次/跨文件夹只加载一次；
 * 缺失 UID 的文件无法判定唯一性，始终保留。
 * 全部为纯函数，可在 Node 环境下单元测试。
 */

interface HasSopUid {
  summary: { sopInstanceUid: string | undefined };
}

export interface DedupeResult<T> {
  /** 首次出现的条目（保持原顺序） */
  kept: T[];
  /** 被跳过的重复条目数 */
  duplicateCount: number;
  /** 去重后的完整 UID 集合（= 输入集合 ∪ kept 的 UID），供调用方累积 */
  nextUids: Set<string>;
}

/**
 * 过滤掉 SOPInstanceUID 已存在于 knownUids（或本批次内重复出现）的条目。
 * @param knownUids 此前已加载的 UID 集合（不会被修改）
 */
export function dedupeBySopUid<T extends HasSopUid>(
  items: readonly T[],
  knownUids: ReadonlySet<string>,
): DedupeResult<T> {
  const seen = new Set(knownUids);
  const kept: T[] = [];
  let duplicateCount = 0;
  for (const item of items) {
    const uid = item.summary.sopInstanceUid;
    if (uid !== undefined && uid !== '') {
      if (seen.has(uid)) {
        duplicateCount += 1;
        continue;
      }
      seen.add(uid);
    }
    kept.push(item);
  }
  return { kept, duplicateCount, nextUids: seen };
}
