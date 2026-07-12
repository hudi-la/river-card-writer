import type { Book, Library } from './bookStore'

// 自动本地快照：跟 backup.ts 的手动导入/导出是两条互补的保险，这条是"用户什么都
// 不用做"的最后一道防线——每次改动都可能悄悄落一份滚动快照，真出事（误删/被同步
// 覆盖/浏览器抽风）时还能从这里捞回来。绝不能因为快照本身而让真正的
// persist(library) 失败或变慢到不可用，所以这个文件里所有对外函数都不抛出。
export const SNAPSHOTS_KEY = 'card-writer:snapshots'

// 最多滚动保留这么多份快照——旧的自动让位给新的，不需要用户管理。
export const MAX_SNAPSHOTS = 12

// localStorage 整体大概 5MB 上限，这里给快照这一个 key 留 4MB，为 library 本身的
// 那个 key（card-writer:library）和其它 key 留出余量，绝不能因为快照占满配额而
// 挤爆真正的存档。
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

type SnapshotEntry = {
  ts: number
  books: { id: string; title: string }[]
  data: Library
}

export type SnapshotSummary = {
  ts: number
  bookTitles: string[]
  bookCount: number
}

// 内部快照数组按时间正序存放（旧→新），对外的 listSnapshots 再倒过来显示。
// 任何解析失败（从没写过/被别的东西弄坏了）都当成"还没有快照"，而不是抛出——
// 快照本身出问题绝不能拖累调用方。
function readAll(): SnapshotEntry[] {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 落盘失败（配额超限、隐私模式禁用 localStorage 等）一律吞掉：快照丢一次不算
// 事故，但绝不能让异常向上传播、影响调用方（尤其是 bookStore 的 persist）。
function writeAll(entries: SnapshotEntry[]): void {
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(entries))
  } catch {
    // quota 超限或序列化失败——吞掉。快照是锦上添花，不是必须成功的操作。
  }
}

// 往滚动快照里追加一条。永不抛出：任何一步出错都吞掉，调用方（尤其是
// bookStore.persist）不需要也不应该为快照失败做任何特殊处理。
export function pushSnapshot(library: Library, now: number = Date.now()): void {
  try {
    const entries = readAll()
    // ts 当唯一键用（getSnapshot 按 ts 查找）。真实调用间隔通常远大于 1ms，但
    // shrink-guard 会绕开节流、可能跟同一次事件循环里的另一次快照撞到同一毫秒
    // （两次 Date.now() 取到同一个值）——那样 getSnapshot 会因为 ts 不唯一分不清
    // 是哪一条。这里保证严格递增：撞了或者时钟倒退，就在最后一条基础上 +1。
    const lastTs = entries.length > 0 ? entries[entries.length - 1].ts : -Infinity
    const ts = now > lastTs ? now : lastTs + 1
    entries.push({
      ts,
      books: library.books.map((b) => ({ id: b.id, title: b.title })),
      data: library,
    })

    // 先按条数裁剪，只留最近 N 条。
    let kept = entries.slice(-MAX_SNAPSHOTS)

    // 再按总体积裁剪：从最旧的开始丢，直到总体积不超过上限，或者只剩最新这一条
    // （最新这条永远优先保留，哪怕它自己就很大——总比一条都没有强）。
    while (kept.length > 1 && JSON.stringify(kept).length > MAX_TOTAL_BYTES) {
      kept = kept.slice(1)
    }

    writeAll(kept)
  } catch {
    // 绝不向外抛出。
  }
}

// 列出所有快照的摘要（书名 + 张数），最新的排在最前，供恢复 UI 展示用。
export function listSnapshots(): SnapshotSummary[] {
  try {
    return readAll()
      .slice()
      .reverse()
      .map((e) => ({ ts: e.ts, bookTitles: e.books.map((b) => b.title), bookCount: e.books.length }))
  } catch {
    return []
  }
}

// 按 ts 取回某一条快照的完整 library；找不到（ts 不存在、快照已被滚动淘汰）时
// 返回 null，不抛出。
export function getSnapshot(ts: number): Library | null {
  try {
    const found = readAll().find((e) => e.ts === ts)
    return found ? found.data : null
  } catch {
    return null
  }
}

// 节流：距离上一次快照不到 minGapMs 就不再快照，避免连续快速编辑时把配额和
// 存储都刷爆。prevTs 为 null（从没快照过）时总是允许——第一次总要有一份底。
export function shouldSnapshot(prevTs: number | null, now: number, minGapMs: number = 90_000): boolean {
  if (prevTs == null) return true
  return now - prevTs >= minGapMs
}

// 纯逻辑，供 bookStore.persist() 调用，也单独可测：这次 persist 该不该快照、
// 该快照哪一份 library。
//   - shrink-guard：新库的书比上一次落盘的库少（可疑的掉书），强制快照"上一次"
//     （掉书发生之前）的那份 library，且绕开节流——掉书这种事绝不能因为"90 秒内
//     刚快照过"就被跳过，那样快照里可能压根没有掉书之前的样子。
//   - 否则：按节流规则决定要不要快照"这一次"的 library。
// 返回 null 表示这次不快照（节流命中，且不是 shrink）。
export function decideSnapshot(
  prevLibrary: Library | null,
  newLibrary: Library,
  now: number,
  lastSnapshotTs: number | null
): Library | null {
  if (prevLibrary && newLibrary.books.length < prevLibrary.books.length) {
    return prevLibrary
  }
  return shouldSnapshot(lastSnapshotTs, now) ? newLibrary : null
}

// 恢复用：某份快照 library 里，有哪些书是当前 library 已经没有的（按 id 比对）。
// 只返回"缺的"，不管内容是否跟当前同 id 的书不同——非破坏性恢复只负责把被删掉的
// 书找补回来，不负责把还在的书回滚到快照时的内容（那样反而可能覆盖用户之后的
// 修改）。纯函数，不 mutate 传入的两个 library。
export function booksMissingFromCurrent(snapshotLibrary: Library, currentLibrary: Library): Book[] {
  const currentIds = new Set(currentLibrary.books.map((b) => b.id))
  return snapshotLibrary.books.filter((b) => !currentIds.has(b.id))
}
