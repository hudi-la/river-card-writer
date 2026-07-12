import { describe, it, expect, vi } from 'vitest'
import { rowToBook, bookToRow, firstSyncPlan, startSync, rowToUniversal, universalToRow, mergeUniversal, mergeUniversalBoxes } from './sync'
import type { CwBookRow, CwUniversalRow, SyncSupabaseClient, SyncableBookStore } from './sync'
import { EMPTY_DOC, UNIVERSAL_BOX_ID } from './bookStore'
import type { Book, Box, Library } from './bookStore'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeBook(id: string, title = '书'): Book {
  return { id, title, doc: structuredClone(EMPTY_DOC), boxes: [{ id: 'box-1', name: '盒', cards: [] }] }
}

function cardWithId(cardId: string, text = '卡'): any {
  return { type: 'card', attrs: { cardId }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

function makeUniversalBox(cards: any[] = [], id = UNIVERSAL_BOX_ID, name = '通用盒子'): Box {
  return { id, name, cards }
}

async function flushAsync(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

// table 路由：cw_books 走 select/upsert/deleteEq，cw_universal 走独立的一套 mock——
// 两张表互不干扰，books 相关断言不会被 universal 那边额外的 select/upsert 调用污染。
function makeMockClient(rows: CwBookRow[] = [], universalRows: CwUniversalRow[] = []) {
  const selectMock = vi.fn().mockResolvedValue({ data: rows, error: null })
  const upsertMock = vi.fn().mockResolvedValue({ error: null })
  const deleteEqMock = vi.fn().mockResolvedValue({ error: null })
  const universalSelectMock = vi.fn().mockResolvedValue({ data: universalRows, error: null })
  const universalUpsertMock = vi.fn().mockResolvedValue({ error: null })
  const client: SyncSupabaseClient = {
    from: vi.fn((table: string) => {
      if (table === 'cw_universal') {
        return { select: universalSelectMock, upsert: universalUpsertMock, delete: () => ({ eq: deleteEqMock }) }
      }
      return { select: selectMock, upsert: upsertMock, delete: () => ({ eq: deleteEqMock }) }
    }),
  }
  return { client, selectMock, upsertMock, deleteEqMock, universalSelectMock, universalUpsertMock }
}

// 最小 zustand-like fake store：满足 SyncableBookStore（getState/subscribe），
// 外加两个测试专用的 helper：_setBooksDirectly 模拟"用户在本地又改了书"，
// _setUniversalDirectly 模拟"用户在本地又改了通用盒子"（只换 universalBoxes，
// books/activeBookId 原样保留，跟真实 store 里两者互不影响的语义一致）。
function makeFakeStore(initialLibrary: Library) {
  let library = initialLibrary
  const listeners = new Set<(state: { library: Library }, prev: { library: Library }) => void>()

  const store: SyncableBookStore & {
    _setBooksDirectly: (books: Book[], activeBookId?: string | null) => void
    _setUniversalDirectly: (universalBoxes: Box[]) => void
  } = {
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
      library = { ...library, books, activeBookId }
      listeners.forEach((l) => l({ library }, prev))
    },
    _setUniversalDirectly: (universalBoxes) => {
      const prev = { library }
      library = { ...library, universalBoxes }
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

describe('universalToRow / rowToUniversal', () => {
  it('往返相等：universalBoxes(数组) -> row -> universalBoxes', () => {
    const boxes = [makeUniversalBox([cardWithId('c1'), cardWithId('c2')]), makeUniversalBox([], 'box-2', '灵感')]
    const row = universalToRow(boxes, 'owner-1')
    expect(row.owner).toBe('owner-1')
    expect(Array.isArray(row.data)).toBe(true)
    expect((row.data as any[])[0].id).toBe(UNIVERSAL_BOX_ID)
    expect((row.data as any[])[0].cards).toEqual(boxes[0].cards)
    expect(rowToUniversal(row)).toEqual(boxes)
  })

  it('老格式行（data 是单个 box 对象，不是数组）→ rowToUniversal 包成单元素数组读出', () => {
    const oldRow: CwUniversalRow = { owner: 'owner-1', data: { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardWithId('legacy')] }, updated_at: new Date().toISOString() }
    const boxes = rowToUniversal(oldRow)
    expect(boxes).toEqual([{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardWithId('legacy')] }])
  })
})

describe('mergeUniversal（非破坏性合并：union，按 cardId 去重——单个盒子内部的卡片层合并）', () => {
  it('保留全部本地卡，追加云端有而本地没有的卡；同 id 时本地版本优先', () => {
    const local = [cardWithId('a'), cardWithId('b')]
    const cloud = [cardWithId('b', '云端版b'), cardWithId('c')]
    const merged = mergeUniversal(local, cloud)
    expect(merged.map((c) => c.attrs.cardId)).toEqual(['a', 'b', 'c'])
    expect(merged.find((c) => c.attrs.cardId === 'b')?.content[0].content[0].text).toBe('卡')
  })

  it('空云端不会删掉任何本地卡（CRITICAL：绝不能因为云端为空就丢本地）', () => {
    const local = [cardWithId('a'), cardWithId('b')]
    expect(mergeUniversal(local, [])).toEqual(local)
  })

  it('空本地 + 有云端 -> 结果就是云端的卡（首次登录、本地还没有通用盒子内容）', () => {
    const cloud = [cardWithId('x')]
    expect(mergeUniversal([], cloud)).toEqual(cloud)
  })

  it('两边都空 -> 空', () => {
    expect(mergeUniversal([], [])).toEqual([])
  })
})

describe('mergeUniversalBoxes（非破坏性合并：按 box id union，每个 box 内部再按 cardId union）', () => {
  it('同 id 的盒子：卡片按 cardId union（本地版本优先），盒子本身不因合并而消失', () => {
    const local = [makeUniversalBox([cardWithId('a'), cardWithId('b')], UNIVERSAL_BOX_ID, '通用盒子')]
    const cloud = [makeUniversalBox([cardWithId('b', '云端版b'), cardWithId('c')], UNIVERSAL_BOX_ID, '通用盒子')]
    const merged = mergeUniversalBoxes(local, cloud)
    expect(merged).toHaveLength(1)
    expect(merged[0].cards.map((c) => c.attrs.cardId)).toEqual(['a', 'b', 'c'])
    expect(merged[0].cards.find((c) => c.attrs.cardId === 'b')?.content[0].content[0].text).toBe('卡')
  })

  it('云端有本地没有的盒子（另一台设备新建的通用盒子）→ 整个追加进结果', () => {
    const local = [makeUniversalBox([cardWithId('a')], UNIVERSAL_BOX_ID, '通用盒子')]
    const cloud = [
      makeUniversalBox([cardWithId('a')], UNIVERSAL_BOX_ID, '通用盒子'),
      makeUniversalBox([cardWithId('x')], 'cloud-only', '云端专属'),
    ]
    const merged = mergeUniversalBoxes(local, cloud)
    expect(merged).toHaveLength(2)
    expect(merged.find((b) => b.id === 'cloud-only')).toEqual(cloud[1])
  })

  it('本地有云端没有的盒子 → 保留（不因云端不知道就被丢弃）', () => {
    const local = [
      makeUniversalBox([cardWithId('a')], UNIVERSAL_BOX_ID, '通用盒子'),
      makeUniversalBox([cardWithId('local-card')], 'local-only', '本地专属'),
    ]
    const merged = mergeUniversalBoxes(local, [])
    expect(merged).toEqual(local)
  })

  it('两边都空 -> 空数组', () => {
    expect(mergeUniversalBoxes([], [])).toEqual([])
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
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
    const stop1 = startSync(store, null, 'owner-1')
    const stop2 = startSync(store, makeMockClient().client, undefined)
    expect(typeof stop1).toBe('function')
    expect(typeof stop2).toBe('function')
    expect(() => stop1()).not.toThrow()
    expect(() => stop2()).not.toThrow()
  })

  it('首登迁移：云空 + 本地有书 → 本地 id 换 uuid 并回填 + upsert 上传到云', async () => {
    const localBook = makeBook('local-nanoid-1', '本地书')
    const store = makeFakeStore({ books: [localBook], activeBookId: 'local-nanoid-1', universalBoxes: [] })
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
    const store = makeFakeStore({ books: [makeBook('local-stale', '本地旧书')], activeBookId: null, universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([row])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.books).toEqual([cloudBook])
    expect(upsertMock).not.toHaveBeenCalled()

    stop()
  })

  it('初始同步完成后，本地再次改动 → 防抖后 upsert 一次', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
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
    const store = makeFakeStore({ books: [existing], activeBookId: null, universalBoxes: [] })
    const { client, deleteEqMock } = makeMockClient([bookToRow(existing, 'owner-1', 0)])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()

    store._setBooksDirectly([], null)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(deleteEqMock).toHaveBeenCalledWith('id', 'uuid-del')

    stop()
  })

  it('stop() 之后不再响应本地改动', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
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

describe('startSync：通用盒子（cw_universal，Phase 14 起一行装 Box[]）', () => {
  it('云端没有该用户的行 → 把本地通用盒子（全部）上传（upsert），本地内容不变', async () => {
    const localUniversal = [makeUniversalBox([cardWithId('a')])]
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: localUniversal })
    const { client, universalUpsertMock } = makeMockClient([], [])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.universalBoxes).toEqual(localUniversal)
    expect(universalUpsertMock).toHaveBeenCalledTimes(1)
    const row = universalUpsertMock.mock.calls[0][0] as CwUniversalRow
    expect(row.owner).toBe('owner-1')
    expect((row.data as any[])[0].cards).toEqual(localUniversal[0].cards)

    stop()
  })

  it('云端有本地没有的卡（同一个盒子）→ 合并后（本地∪云端）落到本地 store，本地原有卡一张不少', async () => {
    const localUniversal = [makeUniversalBox([cardWithId('a')])]
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: localUniversal })
    const cloudRow = universalToRow([makeUniversalBox([cardWithId('a', '云端版a'), cardWithId('b')])], 'owner-1')
    const { client } = makeMockClient([], [cloudRow])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    const merged = store.getState().library.universalBoxes
    expect(merged).toHaveLength(1)
    expect(merged[0].cards.map((c: any) => c.attrs.cardId)).toEqual(['a', 'b'])
    // 本地的 a 版本没被云端同 id 卡覆盖——非破坏性合并
    expect(merged[0].cards.find((c: any) => c.attrs.cardId === 'a')?.content[0].content[0].text).toBe('卡')

    stop()
  })

  it('云端有本地没有的盒子 → 合并后本地多出那个盒子，本地原有盒子/卡一个不少', async () => {
    const localUniversal = [makeUniversalBox([cardWithId('a')], UNIVERSAL_BOX_ID, '通用盒子')]
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: localUniversal })
    const cloudRow = universalToRow(
      [makeUniversalBox([cardWithId('a')], UNIVERSAL_BOX_ID, '通用盒子'), makeUniversalBox([cardWithId('x')], 'cloud-box', '云端新盒子')],
      'owner-1'
    )
    const { client } = makeMockClient([], [cloudRow])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    const merged = store.getState().library.universalBoxes
    expect(merged).toHaveLength(2)
    expect(merged.find((b) => b.id === UNIVERSAL_BOX_ID)?.cards.map((c: any) => c.attrs.cardId)).toEqual(['a'])
    expect(merged.find((b) => b.id === 'cloud-box')?.name).toBe('云端新盒子')

    stop()
  })

  it('云端行是老格式（data 是单个 box 对象）→ 读入时包成数组再合并，不崩', async () => {
    const localUniversal = [makeUniversalBox([cardWithId('a')])]
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: localUniversal })
    const legacyRow: CwUniversalRow = { owner: 'owner-1', data: { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardWithId('a'), cardWithId('legacy')] }, updated_at: new Date().toISOString() }
    const { client } = makeMockClient([], [legacyRow])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    const merged = store.getState().library.universalBoxes
    expect(merged).toHaveLength(1)
    expect(merged[0].cards.map((c: any) => c.attrs.cardId).sort()).toEqual(['a', 'legacy'])

    stop()
  })

  it('云端为空、本地也为空 → 不崩，不产生垃圾 upsert 之外的异常', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [makeUniversalBox([])] })
    const { client } = makeMockClient([], [])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.universalBoxes).toEqual([makeUniversalBox([])])
    stop()
  })

  it('初始同步完成后，本地通用盒子再变 → 防抖后 upsert 一次到 cw_universal', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [makeUniversalBox([])] })
    const { client, universalUpsertMock } = makeMockClient([], [])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()
    universalUpsertMock.mockClear()

    const nextUniversal = [makeUniversalBox([cardWithId('new-card')])]
    store._setUniversalDirectly(nextUniversal)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(universalUpsertMock).toHaveBeenCalledTimes(1)
    const row = universalUpsertMock.mock.calls[0][0] as CwUniversalRow
    expect((row.data as any[])[0].cards).toEqual(nextUniversal[0].cards)

    stop()
  })

  it('未登录（client 为 null）→ 不启动通用盒子同步，纯本地不崩', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [makeUniversalBox([cardWithId('a')])] })
    const stop = startSync(store, null, 'owner-1')
    await flushAsync()
    expect(store.getState().library.universalBoxes[0].cards.map((c: any) => c.attrs.cardId)).toEqual(['a'])
    stop()
  })
})
