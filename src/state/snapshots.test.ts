import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  pushSnapshot,
  listSnapshots,
  getSnapshot,
  shouldSnapshot,
  decideSnapshot,
  booksMissingFromCurrent,
  SNAPSHOTS_KEY,
  MAX_SNAPSHOTS,
} from './snapshots'
import { useBookStore, EMPTY_DOC, UNIVERSAL_BOX_ID, type Library, type Book } from './bookStore'

function book(id: string, title: string): Book {
  return { id, title, doc: structuredClone(EMPTY_DOC), boxes: [] }
}

function library(books: Book[]): Library {
  return { books, activeBookId: null, universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }] }
}

beforeEach(() => {
  localStorage.clear()
})

describe('snapshots — pushSnapshot / listSnapshots / getSnapshot 往返', () => {
  it('pushSnapshot 写入一条快照，listSnapshots 能读到（书名+张数），getSnapshot 能按 ts 取回完整 library', () => {
    const lib = library([book('b1', '书A'), book('b2', '书B')])
    pushSnapshot(lib, 1000)

    const list = listSnapshots()
    expect(list).toHaveLength(1)
    expect(list[0].ts).toBe(1000)
    expect(list[0].bookCount).toBe(2)
    expect(list[0].bookTitles).toEqual(['书A', '书B'])

    const restored = getSnapshot(1000)
    expect(restored).toEqual(lib)
  })

  it('getSnapshot 对不存在的 ts 返回 null', () => {
    expect(getSnapshot(999999)).toBeNull()
  })

  it('listSnapshots 按时间倒序（最新的在最前）', () => {
    pushSnapshot(library([book('b1', 'A')]), 1000)
    pushSnapshot(library([book('b1', 'A'), book('b2', 'B')]), 2000)
    pushSnapshot(library([book('b1', 'A'), book('b2', 'B'), book('b3', 'C')]), 3000)

    const list = listSnapshots()
    expect(list.map((s) => s.ts)).toEqual([3000, 2000, 1000])
  })

  it('空 localStorage 时 listSnapshots 返回空数组，不抛出', () => {
    expect(() => listSnapshots()).not.toThrow()
    expect(listSnapshots()).toEqual([])
  })
})

describe('snapshots — 滚动保留最近 N 条', () => {
  it('推入超过 MAX_SNAPSHOTS 条后，只保留最近的 N 条（最旧的被丢弃）', () => {
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
      pushSnapshot(library([book('b1', `第${i}版`)]), i)
    }
    const list = listSnapshots()
    expect(list.length).toBe(MAX_SNAPSHOTS)
    // 最新的一条 ts 应该是最后推入的
    expect(list[0].ts).toBe(MAX_SNAPSHOTS + 4)
    // 最旧保留的一条应该是第 5 条（0..4 被丢弃）
    expect(list[list.length - 1].ts).toBe(5)
  })
})

describe('snapshots — 总体积上限，超限时裁掉最旧的', () => {
  it('单条快照体积很大时，裁剪掉最旧的条目让总体积不超过约 4MB', () => {
    // 每条快照塞一个 ~1MB 的字符串，超过 4MB 上限（约 4~5 条）时应触发裁剪。
    const bigText = 'x'.repeat(1_000_000)
    for (let i = 0; i < 10; i++) {
      const b = book('b1', bigText)
      pushSnapshot(library([b]), i)
    }
    const raw = localStorage.getItem(SNAPSHOTS_KEY)
    expect(raw).toBeTruthy()
    expect(raw!.length).toBeLessThan(5_000_000)
    // 最新的一条必须还在（永远优先保留最近的）
    const list = listSnapshots()
    expect(list[0].ts).toBe(9)
    expect(list.length).toBeLessThan(10)
  })
})

describe('snapshots — ts 唯一性：同一毫秒推入两条也不会撞车', () => {
  it('两次 pushSnapshot 传入完全相同的 now：第二条的 ts 被顺延，getSnapshot 各自能取回正确的那条', () => {
    pushSnapshot(library([book('b1', '第一条')]), 5000)
    pushSnapshot(library([book('b1', '第二条')]), 5000)

    const list = listSnapshots()
    expect(list).toHaveLength(2)
    const tsSet = new Set(list.map((s) => s.ts))
    expect(tsSet.size).toBe(2) // ts 必须唯一

    for (const s of list) {
      const restored = getSnapshot(s.ts)
      expect(restored!.books[0].title).toBe(s.bookTitles[0])
    }
  })
})

describe('snapshots — quota-safe：写入失败时绝不抛出', () => {
  it('mock localStorage.setItem 一直抛出 QuotaExceededError：pushSnapshot 不抛出', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    expect(() => pushSnapshot(library([book('b1', 'A')]), 1)).not.toThrow()
    spy.mockRestore()
  })

  it('localStorage 里已有损坏的 JSON：pushSnapshot/listSnapshots 都不抛出（当作空列表重新开始）', () => {
    localStorage.setItem(SNAPSHOTS_KEY, 'not json {{{')
    expect(() => pushSnapshot(library([book('b1', 'A')]), 1)).not.toThrow()
    expect(() => listSnapshots()).not.toThrow()
  })
})

describe('snapshots — shouldSnapshot 节流', () => {
  it('prevTs 为 null（从未快照过）：总是 true', () => {
    expect(shouldSnapshot(null, 1000)).toBe(true)
  })

  it('间隔小于 minGapMs：false', () => {
    expect(shouldSnapshot(1000, 1000 + 89_999, 90_000)).toBe(false)
  })

  it('间隔达到/超过 minGapMs：true', () => {
    expect(shouldSnapshot(1000, 1000 + 90_000, 90_000)).toBe(true)
    expect(shouldSnapshot(1000, 1000 + 200_000, 90_000)).toBe(true)
  })
})

describe('snapshots — decideSnapshot（shrink-guard + 节流的纯逻辑）', () => {
  it('shrink-guard：新库书数比上一次少 → 强制返回"上一次"（掉书之前）那份 library，绕开节流', () => {
    const prev = library([book('b1', 'A'), book('b2', 'B')])
    const shrunk = library([book('b1', 'A')])
    // lastSnapshotTs 刚快照过（1 毫秒前），按节流本该跳过，但 shrink 必须绕开节流。
    const target = decideSnapshot(prev, shrunk, 1001, 1000)
    expect(target).toBe(prev)
  })

  it('非 shrink：按节流规则决定——间隔够长就快照"这一次"的 library', () => {
    const prev = library([book('b1', 'A')])
    const grown = library([book('b1', 'A'), book('b2', 'B')])
    expect(decideSnapshot(prev, grown, 100_000, 0)).toBe(grown)
  })

  it('非 shrink 且节流命中（间隔不够）：返回 null，不快照', () => {
    const prev = library([book('b1', 'A')])
    const same = library([book('b1', 'A')])
    expect(decideSnapshot(prev, same, 1_000, 999)).toBeNull()
  })

  it('prevLibrary 为 null（第一次 persist）：走节流规则，第一次总是 true', () => {
    const first = library([book('b1', 'A')])
    expect(decideSnapshot(null, first, 1000, null)).toBe(first)
  })
})

describe('snapshots — booksMissingFromCurrent（恢复用的差集）', () => {
  it('快照比当前多一本书：返回那一本缺的', () => {
    const snap = library([book('b1', 'A'), book('b2', 'B')])
    const current = library([book('b1', 'A')])
    const missing = booksMissingFromCurrent(snap, current)
    expect(missing).toHaveLength(1)
    expect(missing[0].id).toBe('b2')
  })

  it('当前包含快照里的全部书：返回空数组', () => {
    const snap = library([book('b1', 'A')])
    const current = library([book('b1', 'A'), book('b2', 'B')])
    expect(booksMissingFromCurrent(snap, current)).toEqual([])
  })

  it('不 mutate 传入的两个 library', () => {
    const snap = library([book('b1', 'A'), book('b2', 'B')])
    const current = library([book('b1', 'A')])
    const snapBooksBefore = snap.books
    const currentBooksBefore = current.books
    booksMissingFromCurrent(snap, current)
    expect(snap.books).toBe(snapBooksBefore)
    expect(current.books).toBe(currentBooksBefore)
  })
})

describe('snapshots — 集成：shrink-guard 接到真实 bookStore.persist() 上', () => {
  beforeEach(() => {
    localStorage.clear()
    useBookStore.getState().__resetForTest()
  })

  it('删掉一本书前，先把删之前（还有这本书）的 library 强制快照下来', () => {
    const store = useBookStore.getState()
    const b2 = store.addBook('第二本')
    // 此刻 library 有 2 本书（初始那本 + 第二本）。删掉它，应该先把 2 本书的状态存下来。
    const beforeDeleteBookIds = useBookStore.getState().library.books.map((b) => b.id)
    expect(beforeDeleteBookIds).toContain(b2.id)

    useBookStore.getState().deleteBook(b2.id)

    const list = listSnapshots()
    expect(list.length).toBeGreaterThan(0)
    const restorable = list
      .map((s) => getSnapshot(s.ts))
      .find((lib) => lib && lib.books.some((b) => b.id === b2.id))
    expect(restorable).toBeTruthy()
  })

  it('非 shrink 的连续修改：90 秒节流内只落一次快照，节流过后再落一次', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
      useBookStore.getState().__resetForTest()
      useBookStore.getState().addBook('A')
      const afterFirst = listSnapshots().length

      vi.setSystemTime(new Date('2026-07-11T00:00:10.000Z')) // +10s，节流内
      useBookStore.getState().addBook('B')
      expect(listSnapshots().length).toBe(afterFirst)

      vi.setSystemTime(new Date('2026-07-11T00:01:35.000Z')) // +95s，超过节流
      useBookStore.getState().addBook('C')
      expect(listSnapshots().length).toBeGreaterThan(afterFirst)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('snapshots — 集成：非破坏性恢复（restore）经由 importBooks', () => {
  beforeEach(() => {
    localStorage.clear()
    useBookStore.getState().__resetForTest()
  })

  it('恢复一份包含"已被删除的书"的快照：那本书回来了，当前书一本没少', () => {
    const store = useBookStore.getState()
    const survivor = store.library.books[0]
    const removed = store.addBook('会被删除的书')
    const snapBeforeDelete = { ...useBookStore.getState().library }
    store.deleteBook(removed.id)
    expect(useBookStore.getState().library.books.some((b) => b.id === removed.id)).toBe(false)

    const missing = booksMissingFromCurrent(snapBeforeDelete, useBookStore.getState().library)
    useBookStore.getState().importBooks(missing)

    const finalBooks = useBookStore.getState().library.books
    expect(finalBooks.some((b) => b.id === survivor.id)).toBe(true)
    expect(finalBooks.some((b) => b.id === removed.id)).toBe(true)
  })
})
