import { describe, it, expect, vi } from 'vitest'
import { rowToBook, bookToRow, mergeBooksPlan, startSync, rowToUniversal, universalToRow, mergeUniversal, mergeUniversalBoxes, flushToCloud } from './sync'
import type { CwBookRow, CwUniversalRow, SyncSupabaseClient, SyncableBookStore } from './sync'
import { EMPTY_DOC, STARTER_TITLE, STARTER_DOC, UNIVERSAL_BOX_ID } from './bookStore'
import type { Book, Box, Library } from './bookStore'

function makeStarter(id = 'starter-1'): Book {
  return { id, title: STARTER_TITLE, doc: structuredClone(STARTER_DOC), boxes: [] }
}

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
    const book = { ...makeBook('e2c6999a-39f5-514b-8dd9-18af16bcb8f5', '我的书'), updatedAt: '2024-03-01T00:00:00.000Z' }
    const row = bookToRow(book, 'owner-1', 2)
    expect(row.id).toBe('e2c6999a-39f5-514b-8dd9-18af16bcb8f5')
    expect(row.owner).toBe('owner-1')
    expect(row.position).toBe(2)
    expect(row.updated_at).toBe('2024-03-01T00:00:00.000Z')
    expect(rowToBook(row)).toEqual(book)
  })

  it('副标题/作者存活云同步往返（存在 data 里，doc/boxes 不受影响）', () => {
    const book = { ...makeBook('2eaacd88-a129-5b41-a792-0a5678cb5949', '有副标题的书'), subtitle: 'AI 时代的投射', author: 'di hu', updatedAt: '2024-06-01T00:00:00.000Z' }
    const row = bookToRow(book, 'owner-1', 0)
    expect((row.data as any).subtitle).toBe('AI 时代的投射')
    expect((row.data as any).author).toBe('di hu')
    expect(rowToBook(row)).toEqual(book)
  })

  it('没有副标题/作者的书 → data 里不写这两个字段，rowToBook 读回来也没有', () => {
    const book = makeBook('7ba6729a-917c-5757-9731-91cc19ea0950', '没副标题的书')
    const row = bookToRow(book, 'owner-1', 0)
    expect((row.data as any).subtitle).toBeUndefined()
    expect((row.data as any).author).toBeUndefined()
    expect(rowToBook(row)).toEqual({ ...book, updatedAt: row.updated_at })
  })

  it('book 没有 updatedAt 时，bookToRow 兜底用当前时间；round-trip 出来的 book 会带上这个兜底时间', () => {
    const book = makeBook('9433587e-28fe-5518-87b0-a5a043dbd67e', '没有时间戳的书')
    expect(book.updatedAt).toBeUndefined()
    const row = bookToRow(book, 'owner-1', 0)
    expect(typeof row.updated_at).toBe('string')
    expect(rowToBook(row)).toEqual({ ...book, updatedAt: row.updated_at })
  })

  it('没有 cover 的书 → bookToRow 的 cover 列写 null，rowToBook 读回来 cover 是 undefined（不影响其它字段，云端老行同样如此）', () => {
    const book = makeBook('f2c4e3b8-afbd-52b9-9aff-31ee143828b6', '没有封面的书')
    const row = bookToRow(book, 'owner-1', 0)
    expect(row.cover).toBeNull()
    expect(rowToBook(row).cover).toBeUndefined()
    expect(rowToBook(row)).toEqual({ ...book, updatedAt: row.updated_at })
  })

  it('带自定义 cover 的书 → bookToRow/rowToBook 往返 cover 原样保留，doc/boxes 不受影响（cover 是独立于 data 之外的一列）', () => {
    const cover = { colors: ['#111111', '#222222', '#333333'] as [string, string, string], angle: 210, texture: false }
    const book = { ...makeBook('8b520032-6db7-5b4c-95d8-b31ea3b41da9', '有封面的书'), cover, updatedAt: '2024-05-01T00:00:00.000Z' }
    const row = bookToRow(book, 'owner-1', 0)
    expect(row.cover).toEqual(cover)
    // cover 是独立的一列，data 里只有 doc/boxes——改封面不应该把 cover 也塞进 data。
    expect((row.data as any).cover).toBeUndefined()
    expect(rowToBook(row)).toEqual(book)
  })

  it('云端行的 cover 形状不对（脏数据）→ rowToBook 当成没有封面处理，不抛出', () => {
    const book = makeBook('95de41ed-c8e3-5a7d-b98e-7eb82e407301', '书')
    const row = bookToRow(book, 'owner-1', 0)
    ;(row as any).cover = { colors: ['only-one'] }
    expect(() => rowToBook(row)).not.toThrow()
    expect(rowToBook(row).cover).toBeUndefined()
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

  it('盒子 emoji + 颜色存活云同步往返（universalToRow -> rowToUniversal 不丢）', () => {
    const boxes = [{ ...makeUniversalBox([], 'box-e', '灵感'), emoji: '💡', color: '#7fa3c4' }]
    const row = universalToRow(boxes, 'owner-1')
    expect((row.data as any[])[0].emoji).toBe('💡')
    expect((row.data as any[])[0].color).toBe('#7fa3c4')
    expect(rowToUniversal(row)).toEqual(boxes)
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

describe('mergeBooksPlan（非破坏性合并：按 book id union，一本都不能丢）', () => {
  it('云空 + 本地两本 → merged 两本都在（id 换 uuid）+ toUpload 两本 + idRemap 两条', () => {
    const local = [makeBook('local-a'), makeBook('local-b')]
    const plan = mergeBooksPlan(local, [])
    expect(plan.merged).toHaveLength(2)
    expect(plan.toUpload).toHaveLength(2)
    expect(Object.keys(plan.idRemap)).toHaveLength(2)
    expect(plan.idRemap['local-a']).toMatch(UUID_RE)
    expect(plan.idRemap['local-b']).toMatch(UUID_RE)
    const mergedIds = plan.merged.map((b) => b.id)
    expect(mergedIds).toContain(plan.idRemap['local-a'])
    expect(mergedIds).toContain(plan.idRemap['local-b'])
    // 内容（除 id 外）保持不变
    expect(plan.merged.find((b) => b.id === plan.idRemap['local-a'])?.title).toBe(local[0].title)
  })

  it('云有一本、本地有另一本（各自独有）→ merged 两本都在，本地那本 upload、云端那本不重传', () => {
    const cloudBook = makeBook('b8c8ebb7-6d9f-5e0d-917c-aa1e1fa5b76c', '云端书')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = makeBook('local-a', '本地书')
    const plan = mergeBooksPlan([localBook], [row])
    expect(plan.merged.map((b) => b.title).sort()).toEqual(['云端书', '本地书'].sort())
    // 本地那本被换了 uuid 并进了 toUpload；云端那本原样下载，没有出现在 toUpload 里。
    expect(plan.toUpload).toHaveLength(1)
    expect(plan.toUpload[0].title).toBe('本地书')
    expect(plan.idRemap['local-a']).toMatch(UUID_RE)
  })

  it('两边都空 → 全空', () => {
    const plan = mergeBooksPlan([], [])
    expect(plan).toEqual({ merged: [], toUpload: [], idRemap: {} })
  })

  it('同 id 书两边都有，本地 updatedAt 更新 → merged 用本地版本，且进 toUpload', () => {
    const cloudBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '云端标题'), updatedAt: '2024-01-01T00:00:00.000Z' }
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '本地标题'), updatedAt: '2024-06-01T00:00:00.000Z' }
    const plan = mergeBooksPlan([localBook], [row])
    expect(plan.merged).toEqual([localBook])
    expect(plan.toUpload).toEqual([localBook])
  })

  it('同 id 书两边都有，云端 updatedAt 更新 → merged 用云端版本，不进 toUpload', () => {
    const cloudBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '云端标题'), updatedAt: '2024-06-01T00:00:00.000Z' }
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '本地标题'), updatedAt: '2024-01-01T00:00:00.000Z' }
    const plan = mergeBooksPlan([localBook], [row])
    expect(plan.merged[0].title).toBe('云端标题')
    expect(plan.toUpload).toEqual([])
  })

  it('同 id 书两边都有，updatedAt 缺失/相等 → 优先本地', () => {
    const cloudBook = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '云端标题')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '本地标题')
    const plan = mergeBooksPlan([localBook], [row])
    expect(plan.merged[0].title).toBe('本地标题')
  })

  it('同 id 书两边都有，updatedAt 缺失/相等，但本地多了个云端没有的 cover → 视为"内容不同"，进 toUpload（不然本地的封面永远同步不到云端）', () => {
    const cloudBook = makeBook('7cb4b32f-8468-5edb-a07d-7daede640c85')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = { ...makeBook('7cb4b32f-8468-5edb-a07d-7daede640c85'), cover: { colors: ['#111111', '#222222', '#333333'] as [string, string, string] } }
    const plan = mergeBooksPlan([localBook], [row])
    expect(plan.merged[0]).toEqual(localBook)
    expect(plan.toUpload).toEqual([localBook])
  })

  it('同 id 书两边都有、cover 也相同（都没有）→ 仍然当内容相同，不重传', () => {
    const cloudBook = makeBook('885391f7-9050-51f0-a9be-89bfb19b2a10')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = makeBook('885391f7-9050-51f0-a9be-89bfb19b2a10')
    const plan = mergeBooksPlan([localBook], [row])
    expect(plan.toUpload).toEqual([])
  })

  // 没动过的默认教程起始书不该污染账号（登录/换设备时反复被塞进云端）
  it('没动过的教程书 + 云端有真书 → 教程被剔除（不保留、不上传）', () => {
    const row = bookToRow(makeBook('b8c8ebb7-6d9f-5e0d-917c-aa1e1fa5b76c', '云端书'), 'owner-1', 0)
    const plan = mergeBooksPlan([makeStarter()], [row])
    expect(plan.merged.map((b) => b.title)).toEqual(['云端书'])
    expect(plan.toUpload).toEqual([])
  })

  it('没动过的教程书 + 本地另有真书（云空）→ 教程剔除，真书保留并上传', () => {
    const plan = mergeBooksPlan([makeStarter(), makeBook('local-real', '真书')], [])
    expect(plan.merged.map((b) => b.title)).toEqual(['真书'])
    expect(plan.toUpload.map((b) => b.title)).toEqual(['真书'])
  })

  it('全空账号（云空 + 本地只有教程）→ 教程保留，用户至少有本书', () => {
    const plan = mergeBooksPlan([makeStarter()], [])
    expect(plan.merged).toHaveLength(1)
    expect(plan.merged[0].title).toBe(STARTER_TITLE)
  })

  it('用户改过教程书（不再 pristine）+ 云端有书 → 当真书保留并上传', () => {
    const edited = { ...makeStarter('starter-2'), title: '我的新书' }
    const row = bookToRow(makeBook('b8c8ebb7-6d9f-5e0d-917c-aa1e1fa5b76c', '云端书'), 'owner-1', 0)
    const plan = mergeBooksPlan([edited], [row])
    expect(plan.merged.map((b) => b.title).sort()).toEqual(['云端书', '我的新书'].sort())
    expect(plan.toUpload.map((b) => b.title)).toEqual(['我的新书'])
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

  it('REGRESSION（data-loss bug）：云=[A]，本地=[A,B,C]（B,C 本地独有未同步）→ 同步后库里 A,B,C 都在，B/C 被上传，谁都不会被丢', async () => {
    const bookA = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', 'A')
    const rowA = bookToRow(bookA, 'owner-1', 0)
    const bookB = makeBook('local-b', 'B')
    const bookC = makeBook('local-c', 'C')
    const store = makeFakeStore({ books: [bookA, bookB, bookC], activeBookId: 'local-b', universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([rowA])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    const lib = store.getState().library
    // 一本都不能少：A（云端也有）+ B、C（本地独有，之前从未同步过）。
    expect(lib.books.map((b) => b.title).sort()).toEqual(['A', 'B', 'C'])
    expect(lib.books.find((b) => b.title === 'A')?.id).toBe('1b7f6917-fedb-5d09-a71a-678cbfbb4a68')

    // B、C 本地是 nanoid，换成 uuid 后应该被上传到云端，一个都不能漏传。
    const uploadedTitles = (upsertMock.mock.calls.flatMap((call) => call[0]) as CwBookRow[]).map((r) => r.title)
    expect(uploadedTitles.sort()).toEqual(['B', 'C'])

    // activeBookId 指向 B，remap 后应该跟着 B 的新 id 走，不能变成 null 或指向别的书。
    const newBId = lib.books.find((b) => b.title === 'B')?.id
    expect(lib.activeBookId).toBe(newBId)

    stop()
  })

  it('云=[A,B]，本地=[A] → 同步后库里 A、B 都在（B 从云端下载）', async () => {
    const bookA = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', 'A')
    const bookB = makeBook('c3c5414c-2225-57af-8b70-1eed24103850', 'B')
    const rowA = bookToRow(bookA, 'owner-1', 0)
    const rowB = bookToRow(bookB, 'owner-1', 1)
    const store = makeFakeStore({ books: [bookA], activeBookId: '1b7f6917-fedb-5d09-a71a-678cbfbb4a68', universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([rowA, rowB])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    const lib = store.getState().library
    expect(lib.books.map((b) => b.title).sort()).toEqual(['A', 'B'])
    // A 本地云端一致，没有理由重新上传。
    expect(upsertMock).not.toHaveBeenCalled()

    stop()
  })

  it('同一本书两边都有：本地更新（updatedAt 更晚）→ 保留本地版本', async () => {
    const cloudBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '云端标题'), updatedAt: '2024-01-01T00:00:00.000Z' }
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '本地标题（更新）'), updatedAt: '2024-06-01T00:00:00.000Z' }
    const store = makeFakeStore({ books: [localBook], activeBookId: null, universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([row])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.books[0].title).toBe('本地标题（更新）')
    // 本地更新，应该把本地这版重新推回云端。
    expect(upsertMock).toHaveBeenCalledTimes(1)

    stop()
  })

  it('同一本书两边都有：云端更新（updatedAt 更晚）→ 用云端版本覆盖本地', async () => {
    const cloudBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '云端标题（更新）'), updatedAt: '2024-06-01T00:00:00.000Z' }
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = { ...makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '本地旧标题'), updatedAt: '2024-01-01T00:00:00.000Z' }
    const store = makeFakeStore({ books: [localBook], activeBookId: null, universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([row])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.books[0].title).toBe('云端标题（更新）')
    expect(upsertMock).not.toHaveBeenCalled()

    stop()
  })

  it('同一本书两边都有：updatedAt 缺失或相等 → 保留本地（绝不能因为不确定就丢本地改动）', async () => {
    const cloudBook = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '云端标题')
    const row = bookToRow(cloudBook, 'owner-1', 0)
    const localBook = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', '本地标题')
    const store = makeFakeStore({ books: [localBook], activeBookId: null, universalBoxes: [] })
    const { client } = makeMockClient([row])

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.books[0].title).toBe('本地标题')

    stop()
  })

  it('云端为空 + 本地有书 → 全部本地保留并上传（既有行为，合并逻辑下不能回归）', async () => {
    const cloudBook = undefined
    const localBook = makeBook('local-stale', '本地旧书')
    const store = makeFakeStore({ books: [localBook], activeBookId: null, universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([])
    void cloudBook

    const stop = startSync(store, client, 'owner-1')
    await flushAsync()

    expect(store.getState().library.books.map((b) => b.title)).toEqual(['本地旧书'])
    expect(upsertMock).toHaveBeenCalledTimes(1)

    stop()
  })

  it('初始同步完成后，本地再次改动 → 防抖后 upsert 一次', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()
    upsertMock.mockClear()

    const newBook = makeBook('92a33b80-2d87-56c1-8249-05db5672ab97', '新书')
    store._setBooksDirectly([newBook], '92a33b80-2d87-56c1-8249-05db5672ab97')

    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const rows = upsertMock.mock.calls[0][0] as CwBookRow[]
    expect(rows[0].id).toBe('92a33b80-2d87-56c1-8249-05db5672ab97')

    stop()
  })

  it('删除本地书 → 防抖后对该 id 调用 delete().eq()', async () => {
    const existing = makeBook('5a2e4351-da33-58bb-b76a-958909e54327', '待删书')
    const store = makeFakeStore({ books: [existing], activeBookId: null, universalBoxes: [] })
    const { client, deleteEqMock } = makeMockClient([bookToRow(existing, 'owner-1', 0)])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()

    store._setBooksDirectly([], null)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(deleteEqMock).toHaveBeenCalledWith('id', '5a2e4351-da33-58bb-b76a-958909e54327')

    stop()
  })

  it('stop() 之后不再响应本地改动', async () => {
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
    const { client, upsertMock } = makeMockClient([])

    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    await flushAsync()
    upsertMock.mockClear()
    stop()

    store._setBooksDirectly([makeBook('ed07e068-47f4-5a10-afc3-05655bad6d78')], null)
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

describe('flushToCloud（Cmd+S 手动强制保存：不看脏标记，直接把全部书 + 全部通用盒子 upsert 回云端）', () => {
  it('client 为 null → 返回 { ok:false }，不崩', async () => {
    const res = await flushToCloud(null, 'owner-1', { books: [], activeBookId: null, universalBoxes: [] })
    expect(res).toEqual({ ok: false, error: expect.any(String) })
  })

  it('ownerId 缺失 → 返回 { ok:false }，不崩', async () => {
    const { client } = makeMockClient()
    const res = await flushToCloud(client, undefined, { books: [], activeBookId: null, universalBoxes: [] })
    expect(res).toEqual({ ok: false, error: expect.any(String) })
  })

  it('全部书 + 通用盒子一次性 upsert（不管有没有脏标记）', async () => {
    const bookA = makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68', 'A')
    const bookB = makeBook('c3c5414c-2225-57af-8b70-1eed24103850', 'B')
    const universal = [makeUniversalBox([cardWithId('u1')])]
    const { client, upsertMock, universalUpsertMock } = makeMockClient()

    const res = await flushToCloud(client, 'owner-1', { books: [bookA, bookB], activeBookId: '1b7f6917-fedb-5d09-a71a-678cbfbb4a68', universalBoxes: universal })

    expect(res).toEqual({ ok: true })
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const rows = upsertMock.mock.calls[0][0] as CwBookRow[]
    expect(rows.map((r) => r.id).sort()).toEqual(['1b7f6917-fedb-5d09-a71a-678cbfbb4a68', 'c3c5414c-2225-57af-8b70-1eed24103850'])
    expect(rows.every((r) => r.owner === 'owner-1')).toBe(true)

    expect(universalUpsertMock).toHaveBeenCalledTimes(1)
    const uRow = universalUpsertMock.mock.calls[0][0] as CwUniversalRow
    expect(uRow.owner).toBe('owner-1')
    expect((uRow.data as any[])[0].cards).toEqual(universal[0].cards)
  })

  it('books 为空 → 跳过 cw_books upsert，但仍然 upsert cw_universal（哪怕通用盒子也是空数组）', async () => {
    const { client, upsertMock, universalUpsertMock } = makeMockClient()
    const res = await flushToCloud(client, 'owner-1', { books: [], activeBookId: null, universalBoxes: [] })
    expect(res).toEqual({ ok: true })
    expect(upsertMock).not.toHaveBeenCalled()
    expect(universalUpsertMock).toHaveBeenCalledTimes(1)
  })

  it('cw_books upsert 报错 → 返回 { ok:false, error }，不会接着尝试 cw_universal', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: { message: '写入失败' } })
    const universalUpsertMock = vi.fn().mockResolvedValue({ error: null })
    const client: SyncSupabaseClient = {
      from: vi.fn((table: string) => {
        if (table === 'cw_universal') return { select: vi.fn(), upsert: universalUpsertMock, delete: () => ({ eq: vi.fn() }) }
        return { select: vi.fn(), upsert: upsertMock, delete: () => ({ eq: vi.fn() }) }
      }),
    }
    const res = await flushToCloud(client, 'owner-1', { books: [makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68')], activeBookId: null, universalBoxes: [] })
    expect(res).toEqual({ ok: false, error: '写入失败' })
    expect(universalUpsertMock).not.toHaveBeenCalled()
  })

  it('cw_universal upsert 报错 → 返回 { ok:false, error }', async () => {
    const { client, universalUpsertMock } = makeMockClient()
    universalUpsertMock.mockResolvedValueOnce({ error: { message: '通用盒子写入失败' } })
    const res = await flushToCloud(client, 'owner-1', { books: [], activeBookId: null, universalBoxes: [] })
    expect(res).toEqual({ ok: false, error: '通用盒子写入失败' })
  })

  it('client 抛异常（比如网络错误）→ 捕获住，返回 { ok:false, error }，绝不向外抛出', async () => {
    const client: SyncSupabaseClient = {
      from: vi.fn(() => ({
        select: vi.fn(),
        upsert: vi.fn().mockRejectedValue(new Error('network down')),
        delete: () => ({ eq: vi.fn() }),
      })),
    }
    const res = await flushToCloud(client, 'owner-1', { books: [makeBook('1b7f6917-fedb-5d09-a71a-678cbfbb4a68')], activeBookId: null, universalBoxes: [] })
    expect(res).toEqual({ ok: false, error: 'network down' })
  })
})

describe('备料的 hints 与 aiPolicy', () => {
  it('能原样往返 data jsonb', () => {
    const hints = {
      c0: {
        genre: 'narrative' as const,
        genreReason: '动作细节多',
        targets: [{
          zh: '堵', zhQuote: '堵在卧室里', category: '动作质感', priority: 1,
          whyZhIsPrecise: '强弱易位', flatTranslation: { text: 'block', whyItDies: '没生命' },
          candidates: [{ en: 'hem in', verifyForm: 'hem in', register: '书面', nuance: '围困', whyFits: '贴', loses: '没对峙感' }],
          noSingleWord: false, family: '剥夺退路的掌控',
        }],
      },
    }
    const book: Book = { id: '11111111-1111-4111-8111-111111111111', title: '书', doc: {}, boxes: [], hints, aiPolicy: 'strict' }
    const back = rowToBook(bookToRow(book, 'owner', 0))
    expect(back.hints).toEqual(hints)
    expect(back.aiPolicy).toBe('strict')
  })

  it('老行（data 里没有这两个 key）读出来是 undefined，行为零变化', () => {
    const back = rowToBook({
      id: '22222222-2222-4222-8222-222222222222', owner: 'o', title: '老书',
      data: { doc: {}, boxes: [] }, position: 0, updated_at: '2026-01-01T00:00:00Z',
    })
    expect(back.hints).toBeUndefined()
    expect(back.aiPolicy).toBeUndefined()
  })

  it('没有 hints 的书 upsert 时不写 hints key，不给老数据塞空对象', () => {
    const book: Book = { id: '33333333-3333-4333-8333-333333333333', title: '书', doc: {}, boxes: [] }
    const row = bookToRow(book, 'owner', 0)
    expect('hints' in row.data).toBe(false)
    expect('aiPolicy' in row.data).toBe(false)
  })
})

describe('translations 也要往返', () => {
  it('「给译文」的译文能存能读——不然换台电脑就没了', () => {
    const translations = { c1: ['The cat barred the door.', 'It waited.'] }
    const book: Book = { id: '44444444-4444-4444-8444-444444444444', title: '书', doc: {}, boxes: [], translations }
    expect(rowToBook(bookToRow(book, 'owner', 0)).translations).toEqual(translations)
  })

  it('没有译文的书不写 translations key', () => {
    const book: Book = { id: '55555555-5555-4555-8555-555555555555', title: '书', doc: {}, boxes: [] }
    expect('translations' in bookToRow(book, 'owner', 0).data).toBe(false)
  })
})

describe('verified 也要往返', () => {
  it('查证档位能存能读——不然刷新后每个候选都变未查证，好词被集体冤枉', () => {
    const verified = { 'hem in': 'ok' as const, 'swat down': 'rare' as const, 'corner off': 'unverified' as const }
    const book: Book = {
      id: '44444444-4444-4444-8444-444444444444', title: '书', doc: {}, boxes: [], verified,
    }
    expect(rowToBook(bookToRow(book, 'owner', 0)).verified).toEqual(verified)
  })

  it('没有 verified 的书不往 data 里塞空对象', () => {
    const book: Book = { id: '55555555-5555-4555-8555-555555555555', title: '书', doc: {}, boxes: [] }
    expect('verified' in bookToRow(book, 'owner', 0).data).toBe(false)
  })
})

describe('saving safety regressions', () => {
  it('retries a returned upsert error without losing the latest edit', async () => {
    vi.useFakeTimers()
    const { client, upsertMock } = makeMockClient()
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    try {
      await vi.advanceTimersByTimeAsync(0)
      upsertMock.mockResolvedValueOnce({ error: { message: 'offline' } })
      const book = makeBook(crypto.randomUUID(), 'first')
      store._setBooksDirectly([book])
      await vi.advanceTimersByTimeAsync(10)
      const latest = { ...book, title: 'latest' }
      store._setBooksDirectly([latest])
      await vi.advanceTimersByTimeAsync(1000)
      expect(upsertMock).toHaveBeenCalledTimes(2)
      expect(upsertMock.mock.calls[1][0][0].title).toBe('latest')
    } finally { stop(); vi.useRealTimers() }
  })
  it('failed initial download does not upload stale data as if the cloud were empty', async () => {
    vi.useFakeTimers()
    const { client, selectMock, upsertMock } = makeMockClient()
    selectMock.mockResolvedValueOnce({ data: null, error: { message: 'network' } })
    const book = makeBook(crypto.randomUUID())
    const store = makeFakeStore({ books: [book], activeBookId: null, universalBoxes: [] })
    const stop = startSync(store, client, 'owner-1')
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(upsertMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(upsertMock).toHaveBeenCalledOnce()
    } finally { stop(); vi.useRealTimers() }
  })
  it('tracks edits while initial download is still pending', async () => {
    const { client, selectMock, upsertMock } = makeMockClient()
    let resolve!: (v: any) => void
    selectMock.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
    const stop = startSync(store, client, 'owner-1')
    try {
      const book = makeBook(crypto.randomUUID(), 'written during download')
      store._setBooksDirectly([book])
      resolve({ data: [], error: null })
      await flushToCloud(client, 'owner-1', store.getState().library)
      expect(upsertMock.mock.calls[upsertMock.mock.calls.length - 1][0][0].title).toBe(book.title)
    } finally { stop() }
  })
  it('serializes manual and auto saves, retaining edits during an outstanding request', async () => {
    vi.useFakeTimers()
    const { client, upsertMock } = makeMockClient()
    const store = makeFakeStore({ books: [], activeBookId: null, universalBoxes: [] })
    const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
    try {
      await vi.advanceTimersByTimeAsync(0)
      let resolve!: (v: any) => void
      upsertMock.mockImplementationOnce(() => new Promise(r => { resolve = r }))
      const book = makeBook(crypto.randomUUID(), 'first')
      store._setBooksDirectly([book]); await vi.advanceTimersByTimeAsync(10)
      store._setBooksDirectly([{ ...book, title: 'second' }]); await vi.advanceTimersByTimeAsync(10)
      const manual = flushToCloud(client, 'owner-1', store.getState().library)
      expect(upsertMock).toHaveBeenCalledTimes(1)
      resolve({ error: null }); await manual
      expect(upsertMock).toHaveBeenCalledTimes(2)
      expect(upsertMock.mock.calls[1][0][0].title).toBe('second')
    } finally { stop(); vi.useRealTimers() }
  })
  it('does not write after stopping during initialization', async () => {
    const { client, selectMock, upsertMock } = makeMockClient()
    let resolve!: (v: any) => void
    selectMock.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const store = makeFakeStore({ books: [makeBook(crypto.randomUUID())], activeBookId: null, universalBoxes: [] })
    const stop = startSync(store, client, 'owner-1'); stop()
    resolve({ data: [], error: null }); await flushAsync(20)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

it('retries rejected network promises and failed deletions, without unhandled rejections', async () => {
  vi.useFakeTimers()
  const book = makeBook(crypto.randomUUID())
  const { client, upsertMock, deleteEqMock } = makeMockClient([bookToRow(book, 'owner-1', 0)])
  const store = makeFakeStore({ books: [book], activeBookId: null, universalBoxes: [] })
  const stop = startSync(store, client, 'owner-1', { debounceMs: 10 })
  try {
    await vi.advanceTimersByTimeAsync(0)
    upsertMock.mockRejectedValueOnce(new Error('connection reset'))
    store._setBooksDirectly([{ ...book, title: 'edited' }])
    await vi.advanceTimersByTimeAsync(1010)
    expect(upsertMock).toHaveBeenCalledTimes(2)
    deleteEqMock.mockResolvedValueOnce({ error: { message: 'offline delete' } })
    store._setBooksDirectly([])
    await vi.advanceTimersByTimeAsync(1010)
    expect(deleteEqMock).toHaveBeenCalledTimes(2)
  } finally { stop(); vi.useRealTimers() }
})
