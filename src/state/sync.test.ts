import { describe, it, expect, vi } from 'vitest'
import { rowToBook, bookToRow, firstSyncPlan, startSync } from './sync'
import type { CwBookRow, SyncSupabaseClient, SyncableBookStore } from './sync'
import { EMPTY_DOC } from './bookStore'
import type { Book, Library } from './bookStore'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeBook(id: string, title = '书'): Book {
  return { id, title, doc: structuredClone(EMPTY_DOC), boxes: [{ id: 'box-1', name: '盒', cards: [] }] }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function makeMockClient(rows: CwBookRow[] = []) {
  const selectMock = vi.fn().mockResolvedValue({ data: rows, error: null })
  const upsertMock = vi.fn().mockResolvedValue({ error: null })
  const deleteEqMock = vi.fn().mockResolvedValue({ error: null })
  const client: SyncSupabaseClient = {
    from: vi.fn(() => ({
      select: selectMock,
      upsert: upsertMock,
      delete: () => ({ eq: deleteEqMock }),
    })),
  }
  return { client, selectMock, upsertMock, deleteEqMock }
}

// 最小 zustand-like fake store：满足 SyncableBookStore（getState/subscribe），
// 外加一个测试专用的 _setBooksDirectly 模拟“用户在本地又改了书”。
function makeFakeStore(initialLibrary: Library) {
  let library = initialLibrary
  const listeners = new Set<(state: { library: Library }, prev: { library: Library }) => void>()

  const store: SyncableBookStore & { _setBooksDirectly: (books: Book[], activeBookId?: string | null) => void } = {
    getState: () => ({
      library,
      setLibrary: (next: Library) => {
        const prev = { library }
        library = next
        listeners.forEach((l) => l({ library }, prev))
      },
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    _setBooksDirectly: (books, activeBookId = null) => {
      const prev = { library }
      library = { books, activeBookId }
      listeners.forEach((l) => l({ library }, prev))
    },
  }
  return store
}

describe('rowToBook / bookToRow', () => {
  it('往返相等：book -> row -> book', () => {
    const book = makeBook('uuid-1', '我的书')
    const row = bookToRow(book, 'owner-1', 2)
    expect(row.id).toBe('uuid-1')
    expect(row.owner).toBe('owner-1')
    expect(row.position).toBe(2)
    expect(rowToBook(row)).toEqual(book)
  })
})

describe('firstSyncPlan', () => {
  it('云空 + 本地两本 → upload 两本（id 换 uuid）+ idRemap 两条，download 空', () => {
    const local = [makeBook('local-a'), makeBook('local-b')]
    const plan = firstSyncPlan(local, [])
    expect(plan.download).toEqual([])
    expect(plan.upload).toHaveLength(2)
    expect(Object.keys(plan.idRemap)).toHaveLength(2)
    expect(plan.idRemap['local-a']).toMatch(UUID_RE)
    expect(plan.idRemap['local-b']).toMatch(UUID_RE)
    const uploadedIds = plan.upload.map((b) => b.id)
    expect(uploadedIds).toContain(plan.idRemap['local-a'])
    expect(uploadedIds).toContain(plan.idRemap['local-b'])
    // 内容（除 id 外）保持不变
    expect(plan.upload.find((b) => b.id === plan.idRemap['local-a'])?.title).toBe(local[0].title)
  })

  it('云有一本 → download 一本、upload 空、idRemap 空', () => {
    const cloudBook = makeBook('uuid-cloud', '云端书')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const plan = firstSyncPlan([makeBook('local-a')], [row])
    expect(plan.upload).toEqual([])
    expect(plan.download).toEqual([cloudBook])
    expect(plan.idRemap).toEqual({})
  })

  it('两边都空 → 全空', () => {
    const plan = firstSyncPlan([], [])
    expect(plan).toEqual({ upload: [], download: [], idRemap: {} })
  })
})

describe('startSync', () => {
  it('client 为 null 或 ownerId 缺失 → 不启动，返回空操作 stop 函数', () => {
    const store = makeFakeStore({ books: [], activeBookId: null })
    const stop1 = startSync(store, null, 'owner-1')
    const stop2 = startSync(store, makeMockClient().client, undefined)
    expect(typeof stop1).toBe('function')
    expect(typeof stop2).toBe('function')
    expect(() => stop1()).not.toThrow()
    expect(() => stop2()).not.toThrow()
  })

  it('首登迁移：云空 + 本地有书 → 本地 id 换 uuid 并回填 + upsert 上传到云', async () => {
    const localBook = makeBook('local-nanoid-1', '本地书')
    const store = makeFakeStore({ books: [localBook], activeBookId: 'local-nanoid-1' })
    const { client, upsertMock } = makeMockClient([])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    const lib = store.getState().library
    expect(lib.books).toHaveLength(1)
    expect(lib.books[0].id).not.toBe('local-nanoid-1')
    expect(lib.books[0].id).toMatch(UUID_RE)
    expect(lib.books[0].title).toBe('本地书')
    expect(lib.activeBookId).toBe(lib.books[0].id)

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const rows = upsertMock.mock.calls[0][0] as CwBookRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(lib.books[0].id)
    expect(rows[0].owner).toBe('owner-1')

    stop()
  })

  it('云端已有数据 → 下载覆盖本地库（本地当缓存），不上传', async () => {
    const cloudBook = makeBook('uuid-cloud', '云端书')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const store = makeFakeStore({ books: [makeBook('local-stale', '本地旧书')], activeBookId: null })
    const { client, upsertMock } = makeMockClient([row])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.books).toEqual([cloudBook])
    expect(upsertMock).not.toHaveBeenCalled()

    stop()
  })

  it('初始同步完成后，本地再次改动 → 防抖后 upsert 一次', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null })
    const { client, upsertMock } = makeMockClient([])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()
    upsertMock.mockClear()

    const newBook = makeBook('uuid-new', '新书')
    store._setBooksDirectly([newBook], 'uuid-new')

    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const rows = upsertMock.mock.calls[0][0] as CwBookRow[]
    expect(rows[0].id).toBe('uuid-new')

    stop()
  })

  it('删除本地书 → 防抖后对该 id 调用 delete().eq()', async () => {
    const existing = makeBook('uuid-del', '待删书')
    const store = makeFakeStore({ books: [existing], activeBookId: null })
    const { client, deleteEqMock } = makeMockClient([bookToRow(existing, 'owner-1', 0)])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()

    store._setBooksDirectly([], null)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(deleteEqMock).toHaveBeenCalledWith('id', 'uuid-del')

    stop()
  })

  it('stop() 之后不再响应本地改动', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null })
    const { client, upsertMock } = makeMockClient([])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()
    upsertMock.mockClear()
    stop()

    store._setBooksDirectly([makeBook('uuid-after-stop')], null)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(upsertMock).not.toHaveBeenCalled()
  })
})
