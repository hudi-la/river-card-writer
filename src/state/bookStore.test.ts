import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from '../editor/schema'
import { useBookStore, EMPTY_DOC, STARTER_TITLE, STARTER_DOC, isPristineStarter, load, normalizeBook, normalizeLibrary, UNIVERSAL_BOX_ID, isValidCover, type Cover } from './bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

describe('bookStore — shelf/shell', () => {
  it('初始 shell 为 shelf，library 含一本空书，activeBookId 为 null', () => {
    const s = useBookStore.getState()
    expect(s.shell).toBe('shelf')
    expect(s.library.books).toHaveLength(1)
    expect(s.library.activeBookId).toBeNull()
    expect(s.activeBook()).toBeUndefined()
  })

  it('addBook 新增一本书（EMPTY_DOC、空 boxes）、返回它、持久化', () => {
    const before = useBookStore.getState().library.books.length
    const book = useBookStore.getState().addBook('新书')
    expect(book.title).toBe('新书')
    expect(book.doc).toEqual(EMPTY_DOC)
    expect(book.boxes).toEqual([])
    expect(useBookStore.getState().library.books).toHaveLength(before + 1)
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.books.some((b: any) => b.id === book.id && b.title === '新书')).toBe(true)
  })

  it('openBook 后 activeBook().id 匹配、shell 变为 book、viewKind 为 doc', () => {
    const book = useBookStore.getState().addBook('新书')
    useBookStore.getState().openBook(book.id)
    const s = useBookStore.getState()
    expect(s.activeBook()?.id).toBe(book.id)
    expect(s.shell).toBe('book')
    expect(s.viewKind).toBe('doc')
  })

  it('goToShelf 回到 shelf，不清空 activeBookId', () => {
    const book = useBookStore.getState().addBook('新书')
    useBookStore.getState().openBook(book.id)
    useBookStore.getState().goToShelf()
    expect(useBookStore.getState().shell).toBe('shelf')
  })

  it('renameBook 改标题并持久化', () => {
    const book = useBookStore.getState().addBook('旧名')
    useBookStore.getState().renameBook(book.id, '新名')
    expect(useBookStore.getState().library.books.find((b) => b.id === book.id)?.title).toBe('新名')
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.books.find((b: any) => b.id === book.id).title).toBe('新名')
  })

  it('deleteBook 删除非当前书：只减少 books，不影响 shell/activeBookId', () => {
    const bookA = useBookStore.getState().addBook('A')
    const bookB = useBookStore.getState().addBook('B')
    useBookStore.getState().openBook(bookA.id)
    useBookStore.getState().deleteBook(bookB.id)
    const s = useBookStore.getState()
    expect(s.library.books.find((b) => b.id === bookB.id)).toBeUndefined()
    expect(s.library.activeBookId).toBe(bookA.id)
    expect(s.shell).toBe('book')
  })

  it('deleteBook 删除当前书：回到 shelf，books-1，持久化', () => {
    const bookA = useBookStore.getState().addBook('A')
    const before = useBookStore.getState().library.books.length
    useBookStore.getState().openBook(bookA.id)
    useBookStore.getState().deleteBook(bookA.id)
    const s = useBookStore.getState()
    expect(s.shell).toBe('shelf')
    expect(s.library.books).toHaveLength(before - 1)
    expect(s.library.books.find((b) => b.id === bookA.id)).toBeUndefined()
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.books.find((b: any) => b.id === bookA.id)).toBeUndefined()
  })
})

describe('bookStore — 当前书代理', () => {
  it('updateDoc 只改当前书的 doc，另一本书不受影响', () => {
    const bookA = useBookStore.getState().addBook('A')
    const bookB = useBookStore.getState().addBook('B')
    useBookStore.getState().openBook(bookA.id)
    const doc = { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }] }
    useBookStore.getState().updateDoc(doc)

    const s = useBookStore.getState()
    expect(s.activeBook()!.doc).toEqual(doc)
    expect(s.library.books.find((b) => b.id === bookB.id)!.doc).toEqual(EMPTY_DOC)

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.books.find((b: any) => b.id === bookA.id).doc).toEqual(doc)
    expect(raw.books.find((b: any) => b.id === bookB.id).doc).toEqual(EMPTY_DOC)
  })

  it('updateDoc 在没有 activeBook 时是安全的 no-op', () => {
    expect(() => useBookStore.getState().updateDoc({ type: 'doc', content: [] })).not.toThrow()
  })

  it('addBox/parkCard 只改当前书的 boxes，切换书互不影响', () => {
    const bookA = useBookStore.getState().addBook('A')
    const bookB = useBookStore.getState().addBook('B')

    useBookStore.getState().openBook(bookA.id)
    const box = useBookStore.getState().addBox('素材')
    expect(box).toBeDefined()
    const cardJSON = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(box!.id, cardJSON)

    let s = useBookStore.getState()
    expect(s.activeBook()!.boxes).toHaveLength(1)
    expect(s.activeBook()!.boxes[0].cards).toEqual([cardJSON])
    expect(s.library.books.find((b) => b.id === bookB.id)!.boxes).toEqual([])

    useBookStore.getState().openBook(bookB.id)
    s = useBookStore.getState()
    expect(s.activeBook()!.boxes).toEqual([])
    expect(s.getBox(box!.id)).toBeUndefined()

    useBookStore.getState().openBook(bookA.id)
    s = useBookStore.getState()
    expect(s.getBox(box!.id)!.cards).toEqual([cardJSON])
  })

  it('addBox 在没有 activeBook 时安全 no-op，返回 undefined', () => {
    expect(useBookStore.getState().addBox('素材')).toBeUndefined()
  })

  it('renameBox 改名当前书的盒子并持久化，其余盒子不受影响', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('旧盒名')!
    const other = useBookStore.getState().addBox('其它盒子')!
    useBookStore.getState().renameBox(box.id, '新盒名')
    const s = useBookStore.getState()
    expect(s.activeBook()!.boxes.find((b) => b.id === box.id)?.name).toBe('新盒名')
    expect(s.activeBook()!.boxes.find((b) => b.id === other.id)?.name).toBe('其它盒子')
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    const rawBook = raw.books.find((b: any) => b.id === book.id)
    expect(rawBook.boxes.find((b: any) => b.id === box.id).name).toBe('新盒名')
  })

  it('renameBox 忽略空名（trim 后为空），盒子名不变', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('旧盒名')!
    useBookStore.getState().renameBox(box.id, '   ')
    expect(useBookStore.getState().activeBook()!.boxes.find((b) => b.id === box.id)?.name).toBe('旧盒名')
  })

  it('takeCardFromBox / carry / cancelCarry / dropCarried 作用于当前书', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材')!
    const cardJSON = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(box.id, cardJSON)

    useBookStore.getState().openBox(box.id)
    useBookStore.getState().carry(box.id, 'c1')
    let s = useBookStore.getState()
    expect(s.carried).toEqual({ boxId: box.id, cardId: 'c1' })
    expect(s.viewKind).toBe('doc')

    useBookStore.getState().cancelCarry()
    expect(useBookStore.getState().carried).toBeNull()

    const taken = useBookStore.getState().takeCardFromBox(box.id, 'c1')
    expect(taken).toEqual(cardJSON)
    expect(useBookStore.getState().getBox(box.id)!.cards).toEqual([])

    useBookStore.getState().carry(box.id, 'c1')
    useBookStore.getState().dropCarried()
    expect(useBookStore.getState().carried).toBeNull()
  })
})

describe('bookStore — 库级通用盒子（多个、可命名）', () => {
  it('初始 library.universalBoxes 只有一个默认的空通用盒子', () => {
    const s = useBookStore.getState()
    expect(s.library.universalBoxes).toEqual([{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }])
  })

  it('addUniversalBox 新增一个具名通用盒子，+1，持久化', () => {
    const before = useBookStore.getState().library.universalBoxes.length
    const box = useBookStore.getState().addUniversalBox('灵感')
    expect(box.name).toBe('灵感')
    expect(box.cards).toEqual([])
    expect(useBookStore.getState().library.universalBoxes).toHaveLength(before + 1)
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.universalBoxes.some((b: any) => b.id === box.id && b.name === '灵感')).toBe(true)
  })

  it('renameUniversalBox 改名并持久化，其余盒子不受影响', () => {
    const box = useBookStore.getState().addUniversalBox('旧名')
    useBookStore.getState().renameUniversalBox(box.id, '新名')
    const s = useBookStore.getState()
    expect(s.library.universalBoxes.find((b) => b.id === box.id)?.name).toBe('新名')
    expect(s.library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)?.name).toBe('通用盒子')
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.universalBoxes.find((b: any) => b.id === box.id).name).toBe('新名')
  })

  it('deleteUniversalBox 删除指定盒子，其余保留', () => {
    const box = useBookStore.getState().addUniversalBox('临时')
    useBookStore.getState().deleteUniversalBox(box.id)
    const s = useBookStore.getState()
    expect(s.library.universalBoxes.find((b) => b.id === box.id)).toBeUndefined()
    expect(s.library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)).toBeDefined()
  })

  it('parkCard(id, card) 按 id 命中对应的通用盒子，不进任何一本书，也不进另一个通用盒子', () => {
    const bookA = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(bookA.id)
    const inspiration = useBookStore.getState().addUniversalBox('灵感')

    const cardJSON = { type: 'card', attrs: { cardId: 'u1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(inspiration.id, cardJSON)

    const s = useBookStore.getState()
    expect(s.getBox(inspiration.id)!.cards).toEqual([cardJSON])
    expect(s.getBox(UNIVERSAL_BOX_ID)!.cards).toEqual([])
    expect(s.activeBook()!.boxes).toEqual([])

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.universalBoxes.find((b: any) => b.id === inspiration.id).cards).toEqual([cardJSON])
  })

  it('跨书：openBook(A) 后 park 进某个通用盒子，再 openBook(B)，getBox(该 id) 仍含该卡（全局共享同一实例）', () => {
    const bookA = useBookStore.getState().addBook('A')
    const bookB = useBookStore.getState().addBook('B')

    useBookStore.getState().openBook(bookA.id)
    const cardJSON = { type: 'card', attrs: { cardId: 'u2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cross' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON)

    useBookStore.getState().openBook(bookB.id)
    const s = useBookStore.getState()
    expect(s.getBox(UNIVERSAL_BOX_ID)!.cards).toEqual([cardJSON])
    expect(s.activeBook()!.boxes).toEqual([])
  })

  it('takeCardFromBox(id, cardId) 从对应通用盒子取出并移除，其余通用盒子不受影响', () => {
    const inspiration = useBookStore.getState().addUniversalBox('灵感')
    const cardJSON = { type: 'card', attrs: { cardId: 'u3' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'take' }] }] }
    useBookStore.getState().parkCard(inspiration.id, cardJSON)
    const otherCard = { type: 'card', attrs: { cardId: 'u3b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'other' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, otherCard)

    const taken = useBookStore.getState().takeCardFromBox(inspiration.id, 'u3')
    expect(taken).toEqual(cardJSON)
    expect(useBookStore.getState().getBox(inspiration.id)!.cards).toEqual([])
    expect(useBookStore.getState().getBox(UNIVERSAL_BOX_ID)!.cards).toEqual([otherCard])
  })

  it('carry/dropCarried 支持通用盒子 id：装载后经 takeCardFromBox 落定，该通用盒子少一张', () => {
    const cardJSON = { type: 'card', attrs: { cardId: 'u4' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'carry' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON)

    useBookStore.getState().carry(UNIVERSAL_BOX_ID, 'u4')
    expect(useBookStore.getState().carried).toEqual({ boxId: UNIVERSAL_BOX_ID, cardId: 'u4' })

    const taken = useBookStore.getState().takeCardFromBox(UNIVERSAL_BOX_ID, 'u4')
    useBookStore.getState().dropCarried()

    expect(taken).toEqual(cardJSON)
    expect(useBookStore.getState().carried).toBeNull()
    expect(useBookStore.getState().getBox(UNIVERSAL_BOX_ID)!.cards).toEqual([])
  })

  it('openUniversalBox 切换 shell 为 universal；goToShelf 能从 universal 回到 shelf', () => {
    useBookStore.getState().openUniversalBox()
    expect(useBookStore.getState().shell).toBe('universal')

    useBookStore.getState().goToShelf()
    expect(useBookStore.getState().shell).toBe('shelf')
  })

  it('书内 openBox(UNIVERSAL_BOX_ID) 照常进入 box 视图，getBox 解析到默认通用盒子', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    useBookStore.getState().openBox(UNIVERSAL_BOX_ID)

    const s = useBookStore.getState()
    expect(s.viewKind).toBe('box')
    expect(s.activeBoxId).toBe(UNIVERSAL_BOX_ID)
    expect(s.getBox(s.activeBoxId)).toBe(s.library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID))
  })

  it('importUniversalCards：非破坏性地按 cardId 去重合并进默认通用盒子（id=UNIVERSAL_BOX_ID），并持久化', () => {
    const existing = { type: 'card', attrs: { cardId: 'kept' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, existing)

    const fresh = { type: 'card', attrs: { cardId: 'new1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '新的' }] }] }
    const dup = { type: 'card', attrs: { cardId: 'kept' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '撞车，理应被丢弃' }] }] }
    useBookStore.getState().importUniversalCards([fresh, dup])

    const s = useBookStore.getState()
    const defaultBox = s.library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)!
    expect(defaultBox.cards).toHaveLength(2)
    expect(defaultBox.cards).toContainEqual(existing)
    expect(defaultBox.cards).toContainEqual(fresh)
    // 撞车的导入卡被丢弃，现有那张原样保留（内容没被覆盖）
    expect(defaultBox.cards.filter((c) => c.attrs.cardId === 'kept')).toEqual([existing])

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.universalBoxes.find((b: any) => b.id === UNIVERSAL_BOX_ID).cards).toHaveLength(2)
  })

  it('importUniversalCards：重复导入同一批卡不会堆出重复', () => {
    const card = { type: 'card', attrs: { cardId: 'once' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '一次' }] }] }
    useBookStore.getState().importUniversalCards([card])
    useBookStore.getState().importUniversalCards([card])
    expect(useBookStore.getState().getBox(UNIVERSAL_BOX_ID)!.cards).toHaveLength(1)
  })
})

// 拖拽重排三个新 action：moveBox（本书盒子重排）、moveCardInBox（盒内卡片重排）、
// moveCardToBox（盒子之间搬卡，覆盖本书盒子/通用盒子任意组合）。DATA-SAFETY 铁律：
// 每次操作前后，盒子数、卡片数（单盒内以及跨盒总数）必须守恒——测试逐条断言。
describe('bookStore — 拖拽重排 action（moveBox / moveCardInBox / moveCardToBox）', () => {
  it('moveBox 把盒子挪到目标下标，其余盒子顺序跟着让位，盒子总数不变，每个盒子的卡片原样不丢', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const boxA = useBookStore.getState().addBox('A盒')!
    const boxB = useBookStore.getState().addBox('B盒')!
    const boxC = useBookStore.getState().addBox('C盒')!
    const cardJSON = { type: 'card', attrs: { cardId: 'c1' }, content: [] }
    useBookStore.getState().parkCard(boxA.id, cardJSON)

    const beforeCount = useBookStore.getState().activeBook()!.boxes.length

    // 把 A 挪到下标 2（移除 A 后剩 [B, C]，插到 2 即末尾）→ [B, C, A]
    useBookStore.getState().moveBox(boxA.id, 2)

    const s = useBookStore.getState()
    expect(s.activeBook()!.boxes.map((b) => b.id)).toEqual([boxB.id, boxC.id, boxA.id])
    expect(s.activeBook()!.boxes).toHaveLength(beforeCount)
    expect(s.getBox(boxA.id)!.cards).toEqual([cardJSON])

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    const rawBook = raw.books.find((b: any) => b.id === book.id)
    expect(rawBook.boxes.map((b: any) => b.id)).toEqual([boxB.id, boxC.id, boxA.id])
  })

  it('moveBox 越界下标被夹到合法范围内，不抛出、不丢盒子', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const boxA = useBookStore.getState().addBox('A盒')!
    const boxB = useBookStore.getState().addBox('B盒')!
    expect(() => useBookStore.getState().moveBox(boxA.id, 999)).not.toThrow()
    const s = useBookStore.getState()
    expect(s.activeBook()!.boxes.map((b) => b.id)).toEqual([boxB.id, boxA.id])
    expect(s.activeBook()!.boxes).toHaveLength(2)
  })

  it('moveBox 对不存在的 boxId 安全 no-op，不丢/不改盒子顺序', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const boxA = useBookStore.getState().addBox('A盒')!
    expect(() => useBookStore.getState().moveBox('not-exist', 0)).not.toThrow()
    expect(useBookStore.getState().activeBook()!.boxes.map((b) => b.id)).toEqual([boxA.id])
  })

  it('moveCardInBox 在同一个盒子内重排卡片，卡片数量守恒，内容原样不丢', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材')!
    const c1 = { type: 'card', attrs: { cardId: 'c1' }, content: [] }
    const c2 = { type: 'card', attrs: { cardId: 'c2' }, content: [] }
    const c3 = { type: 'card', attrs: { cardId: 'c3' }, content: [] }
    useBookStore.getState().parkCard(box.id, c1)
    useBookStore.getState().parkCard(box.id, c2)
    useBookStore.getState().parkCard(box.id, c3)

    // 把 c1 挪到末尾（移除后剩 [c2, c3]，插到下标 2）→ [c2, c3, c1]
    useBookStore.getState().moveCardInBox(box.id, 'c1', 2)

    const s = useBookStore.getState()
    const cards = s.getBox(box.id)!.cards
    expect(cards.map((c) => c.attrs.cardId)).toEqual(['c2', 'c3', 'c1'])
    expect(cards).toHaveLength(3)
  })

  it('moveCardInBox 也支持通用盒子（盒内重排不限于本书盒子）', () => {
    const box = useBookStore.getState().addUniversalBox('灵感')
    const c1 = { type: 'card', attrs: { cardId: 'u1' }, content: [] }
    const c2 = { type: 'card', attrs: { cardId: 'u2' }, content: [] }
    useBookStore.getState().parkCard(box.id, c1)
    useBookStore.getState().parkCard(box.id, c2)

    useBookStore.getState().moveCardInBox(box.id, 'u2', 0)

    const cards = useBookStore.getState().getBox(box.id)!.cards
    expect(cards.map((c) => c.attrs.cardId)).toEqual(['u2', 'u1'])
    expect(cards).toHaveLength(2)
  })

  it('moveCardToBox 把卡从本书盒子搬进通用盒子：源盒少一张，目标盒多一张，两盒总数守恒', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const fromBox = useBookStore.getState().addBox('素材')!
    const c1 = { type: 'card', attrs: { cardId: 'c1' }, content: [] }
    const c2 = { type: 'card', attrs: { cardId: 'c2' }, content: [] }
    useBookStore.getState().parkCard(fromBox.id, c1)
    useBookStore.getState().parkCard(fromBox.id, c2)
    const uniBefore = useBookStore.getState().getBox(UNIVERSAL_BOX_ID)!.cards.length
    const totalBefore = fromBox && 2 + uniBefore

    useBookStore.getState().moveCardToBox(fromBox.id, 'c1', UNIVERSAL_BOX_ID)

    const s = useBookStore.getState()
    const fromCards = s.getBox(fromBox.id)!.cards
    const toCards = s.getBox(UNIVERSAL_BOX_ID)!.cards
    expect(fromCards.map((c) => c.attrs.cardId)).toEqual(['c2'])
    expect(toCards.some((c) => c.attrs.cardId === 'c1')).toBe(true)
    expect(fromCards.length + toCards.length).toBe(totalBefore)

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    const rawBook = raw.books.find((b: any) => b.id === book.id)
    expect(rawBook.boxes.find((b: any) => b.id === fromBox.id).cards.map((c: any) => c.attrs.cardId)).toEqual(['c2'])
    expect(raw.universalBoxes.find((b: any) => b.id === UNIVERSAL_BOX_ID).cards.some((c: any) => c.attrs.cardId === 'c1')).toBe(true)
  })

  it('moveCardToBox 把卡从通用盒子搬进本书盒子：方向反过来同样守恒', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const toBox = useBookStore.getState().addBox('素材')!
    const card = { type: 'card', attrs: { cardId: 'u9' }, content: [] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, card)

    useBookStore.getState().moveCardToBox(UNIVERSAL_BOX_ID, 'u9', toBox.id)

    const s = useBookStore.getState()
    expect(s.getBox(UNIVERSAL_BOX_ID)!.cards.some((c) => c.attrs.cardId === 'u9')).toBe(false)
    expect(s.getBox(toBox.id)!.cards.map((c) => c.attrs.cardId)).toEqual(['u9'])
  })

  it('moveCardToBox 支持在两个本书盒子之间搬卡', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const boxA = useBookStore.getState().addBox('A盒')!
    const boxB = useBookStore.getState().addBox('B盒')!
    const card = { type: 'card', attrs: { cardId: 'x1' }, content: [] }
    useBookStore.getState().parkCard(boxA.id, card)

    useBookStore.getState().moveCardToBox(boxA.id, 'x1', boxB.id, 0)

    const s = useBookStore.getState()
    expect(s.getBox(boxA.id)!.cards).toEqual([])
    expect(s.getBox(boxB.id)!.cards).toEqual([card])
  })

  it('moveCardToBox 目标 = 源盒子（同盒）时安全地当重排处理：不重复、不丢，数量不变', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材')!
    const c1 = { type: 'card', attrs: { cardId: 'c1' }, content: [] }
    const c2 = { type: 'card', attrs: { cardId: 'c2' }, content: [] }
    useBookStore.getState().parkCard(box.id, c1)
    useBookStore.getState().parkCard(box.id, c2)

    useBookStore.getState().moveCardToBox(box.id, 'c1', box.id, 1)

    const cards = useBookStore.getState().getBox(box.id)!.cards
    expect(cards).toHaveLength(2)
    expect(cards.filter((c) => c.attrs.cardId === 'c1')).toHaveLength(1)
    expect(cards.filter((c) => c.attrs.cardId === 'c2')).toHaveLength(1)
  })

  it('moveCardToBox 省略 targetIndex 时追加到目标盒末尾', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const fromBox = useBookStore.getState().addBox('素材')!
    const toBox = useBookStore.getState().addBox('目标')!
    const existing = { type: 'card', attrs: { cardId: 'e1' }, content: [] }
    const moving = { type: 'card', attrs: { cardId: 'm1' }, content: [] }
    useBookStore.getState().parkCard(toBox.id, existing)
    useBookStore.getState().parkCard(fromBox.id, moving)

    useBookStore.getState().moveCardToBox(fromBox.id, 'm1', toBox.id)

    expect(useBookStore.getState().getBox(toBox.id)!.cards.map((c) => c.attrs.cardId)).toEqual(['e1', 'm1'])
  })

  it('moveCardToBox 找不到目标盒子时安全放弃：卡留在源盒子，不丢不重', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const fromBox = useBookStore.getState().addBox('素材')!
    const card = { type: 'card', attrs: { cardId: 'c1' }, content: [] }
    useBookStore.getState().parkCard(fromBox.id, card)

    expect(() => useBookStore.getState().moveCardToBox(fromBox.id, 'c1', 'not-exist')).not.toThrow()
    expect(useBookStore.getState().getBox(fromBox.id)!.cards).toEqual([card])
  })

  it('moveCardToBox 找不到源卡片时安全 no-op', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const fromBox = useBookStore.getState().addBox('素材')!
    const toBox = useBookStore.getState().addBox('目标')!
    expect(() => useBookStore.getState().moveCardToBox(fromBox.id, 'nope', toBox.id)).not.toThrow()
    expect(useBookStore.getState().getBox(toBox.id)!.cards).toEqual([])
  })
})

// updateBoxCard：卡片弹窗编辑（Google-Keep 式展开编辑）落盘的 action。DATA-SAFETY
// 铁律——原地替换内容、强制沿用原 cardId、盒子卡片总数守恒、不动任何别的卡、
// 找不到盒子/卡片一律安全 no-op（绝不新增/丢弃卡片）。
describe('bookStore — updateBoxCard（卡片弹窗编辑落盘）', () => {
  it('替换本书盒子里指定卡片的内容，cardId 不变，盒子卡数不变，兄弟卡原样不动', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材')!
    const c1 = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '旧内容' }] }] }
    const c2 = { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '别的卡' }] }] }
    useBookStore.getState().parkCard(box.id, c1)
    useBookStore.getState().parkCard(box.id, c2)

    const newContent = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '新内容' }] }] }
    useBookStore.getState().updateBoxCard(box.id, 'c1', newContent)

    const s = useBookStore.getState()
    const cards = s.getBox(box.id)!.cards
    expect(cards).toHaveLength(2)
    expect(cards[0].attrs.cardId).toBe('c1')
    expect(cards[0].content[0].content[0].text).toBe('新内容')
    expect(cards[1]).toEqual(c2) // 兄弟卡原样不动（同一引用/同一内容）

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    const rawBook = raw.books.find((b: any) => b.id === book.id)
    const rawBox = rawBook.boxes.find((b: any) => b.id === box.id)
    expect(rawBox.cards[0].attrs.cardId).toBe('c1')
    expect(rawBox.cards[0].content[0].content[0].text).toBe('新内容')
  })

  it('也支持通用盒子', () => {
    const box = useBookStore.getState().addUniversalBox('灵感')
    const u1 = { type: 'card', attrs: { cardId: 'u1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] }
    useBookStore.getState().parkCard(box.id, u1)

    useBookStore.getState().updateBoxCard(box.id, 'u1', { type: 'card', attrs: { cardId: 'u1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }] })

    const cards = useBookStore.getState().getBox(box.id)!.cards
    expect(cards).toHaveLength(1)
    expect(cards[0].attrs.cardId).toBe('u1')
    expect(cards[0].content[0].content[0].text).toBe('new')
  })

  it('强制沿用原 cardId：即便传入的 cardJSON.attrs.cardId 是别的值/缺失，也不会改成那个值', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材')!
    useBookStore.getState().parkCard(box.id, { type: 'card', attrs: { cardId: 'c1' }, content: [] })

    // 传一个 attrs.cardId 被改乱/丢失的 JSON（模拟从单卡文档 editor.getJSON() 拿到的、
    // cardId 可能对不上或被清空的场景）
    useBookStore.getState().updateBoxCard(box.id, 'c1', { type: 'card', attrs: { cardId: 'someone-else' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] })
    let cards = useBookStore.getState().getBox(box.id)!.cards
    expect(cards.map((c) => c.attrs.cardId)).toEqual(['c1'])

    useBookStore.getState().updateBoxCard(box.id, 'c1', { type: 'card', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y' }] }] })
    cards = useBookStore.getState().getBox(box.id)!.cards
    expect(cards.map((c) => c.attrs.cardId)).toEqual(['c1'])
    expect(cards[0].content[0].content[0].text).toBe('y')
  })

  it('盒子不存在时安全 no-op，不抛出、不新增盒子/卡片', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    expect(() => useBookStore.getState().updateBoxCard('not-exist', 'c1', { type: 'card', attrs: { cardId: 'c1' }, content: [] })).not.toThrow()
    expect(useBookStore.getState().activeBook()!.boxes).toHaveLength(0)
  })

  it('卡片在盒子里找不到时安全 no-op，盒子卡数不变', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材')!
    const c1 = { type: 'card', attrs: { cardId: 'c1' }, content: [] }
    useBookStore.getState().parkCard(box.id, c1)

    expect(() => useBookStore.getState().updateBoxCard(box.id, 'nope', { type: 'card', attrs: { cardId: 'nope' }, content: [] })).not.toThrow()

    const cards = useBookStore.getState().getBox(box.id)!.cards
    expect(cards).toEqual([c1])
  })
})

describe('bookStore — 迁移 & normalizeLibrary', () => {
  it('load() 优先读 card-writer:library', () => {
    localStorage.clear()
    const lib = { books: [{ id: 'b1', title: 't', doc: EMPTY_DOC, boxes: [] }], activeBookId: 'b1' }
    localStorage.setItem('card-writer:library', JSON.stringify(lib))
    const loaded = load()
    expect(loaded.books).toHaveLength(1)
    expect(loaded.books[0].id).toBe('b1')
    expect(loaded.activeBookId).toBe('b1')
  })

  it('无 library 但有旧单本 card-writer:book → 包成 library，内容深等，activeBookId 为 null', () => {
    localStorage.clear()
    const oldBook = { id: 'old1', title: '旧书', doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }, boxes: [{ id: 'bx1', name: '盒', cards: [] }] }
    localStorage.setItem('card-writer:book', JSON.stringify(oldBook))
    const loaded = load()
    expect(loaded.books).toHaveLength(1)
    expect(loaded.books[0]).toEqual(oldBook)
    expect(loaded.activeBookId).toBeNull()
  })

  it('都无 → 空 library：一本新手教程起始书，activeBookId 为 null', () => {
    localStorage.clear()
    const loaded = load()
    expect(loaded.books).toHaveLength(1)
    expect(loaded.books[0].title).toBe(STARTER_TITLE)
    expect(isPristineStarter(loaded.books[0])).toBe(true)
    expect(loaded.books[0].boxes).toEqual([])
    expect(loaded.activeBookId).toBeNull()
  })

  it('load() 遇到形状不对但可解析的 library JSON 时回退，不抛出', () => {
    localStorage.clear()
    localStorage.setItem('card-writer:library', JSON.stringify({ foo: 1 }))
    let lib: ReturnType<typeof load> | undefined
    expect(() => {
      lib = load()
    }).not.toThrow()
    expect(lib!.books).toHaveLength(1)
    expect(lib!.books[0].title).toBe(STARTER_TITLE)
  })

  it('新手教程起始书：doc 是合法 ProseMirror 文档（能被编辑器 schema 加载）', () => {
    const editor = new Editor({ extensions: baseExtensions, content: STARTER_DOC })
    // 能实例化即通过 schema 校验；再确认往返 JSON 结构没塌
    expect(editor.getJSON().type).toBe('doc')
    expect(editor.getJSON().content!.length).toBe(STARTER_DOC.content.length)
    editor.destroy()
  })

  it('isPristineStarter：未改的教程书为 true；改了标题/正文即为 false', () => {
    localStorage.clear()
    const b = load().books[0]
    expect(isPristineStarter(b)).toBe(true)
    expect(isPristineStarter({ ...b, title: '我的书' })).toBe(false)
    expect(isPristineStarter({ ...b, doc: EMPTY_DOC })).toBe(false)
    expect(isPristineStarter({ ...b, boxes: [{ id: 'x', name: '盒', cards: [] }] })).toBe(false)
  })

  it('normalizeLibrary 补全缺失的 books/activeBookId', () => {
    const lib = normalizeLibrary({})
    expect(lib.books).toEqual([])
    expect(lib.activeBookId).toBeNull()
  })

  it('normalizeLibrary 对既无 universalBoxes 也无老 universalBox 的库补一个默认通用盒子，且 books 原样保留（byte-identical，一律不动）', () => {
    const oldLib = {
      books: [
        { id: 'b1', title: '书一', doc: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] }] }, boxes: [{ id: 'bx1', name: '素材', cards: [{ type: 'card', attrs: { cardId: 'y' }, content: [] }] }] },
        { id: 'b2', title: '书二', doc: EMPTY_DOC, boxes: [] },
      ],
      activeBookId: 'b1',
    }
    const beforeSnapshot = JSON.parse(JSON.stringify(oldLib.books))

    const lib = normalizeLibrary(oldLib)

    expect(lib.universalBoxes).toEqual([{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }])
    expect(lib.books).toEqual(beforeSnapshot)
    expect(lib.activeBookId).toBe('b1')
    // 传入的原始对象本身也没被 mutate。
    expect(oldLib.books).toEqual(beforeSnapshot)
  })

  it('normalizeLibrary 迁移：老格式的单个 universalBox（带卡）→ universalBoxes 数组，原盒子和卡片一张不丢（DATA-SAFETY）', () => {
    const oldSingleBox = {
      id: UNIVERSAL_BOX_ID,
      name: '通用盒子',
      cards: [
        { type: 'card', attrs: { cardId: 'kept-1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '老卡一' }] }] },
        { type: 'card', attrs: { cardId: 'kept-2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '老卡二' }] }] },
      ],
    }
    const beforeSnapshot = JSON.parse(JSON.stringify(oldSingleBox))
    const oldLib = { books: [], activeBookId: null, universalBox: oldSingleBox }

    const lib = normalizeLibrary(oldLib)

    expect(lib.universalBoxes).toHaveLength(1)
    expect(lib.universalBoxes[0]).toEqual(beforeSnapshot)
    expect(lib.universalBoxes[0].cards).toHaveLength(2)
    // 传入的原始对象本身也没被 mutate。
    expect(oldSingleBox).toEqual(beforeSnapshot)
  })

  it('normalizeLibrary 迁移：老格式的单个 universalBox 即使 id/name 是自定义的，也原样保留（不强改成默认 id/name）', () => {
    const customBox = { id: 'custom-old-id', name: '我的旧通用盒', cards: [{ type: 'card', attrs: { cardId: 'x' }, content: [] }] }
    const lib = normalizeLibrary({ books: [], activeBookId: null, universalBox: customBox })
    expect(lib.universalBoxes).toEqual([customBox])
  })

  it('normalizeLibrary 已有合法 universalBoxes 数组时原样保留（不重建、不清空已有盒子/卡，同名不同 id 的多个盒子都保留）', () => {
    const existingBoxes = [
      { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [{ type: 'card', attrs: { cardId: 'kept' }, content: [] }] },
      { id: 'custom-2', name: '灵感', cards: [] },
    ]
    const lib = normalizeLibrary({ books: [], activeBookId: null, universalBoxes: existingBoxes })
    expect(lib.universalBoxes).toEqual(existingBoxes)
    expect(lib.universalBoxes).toHaveLength(2)
  })

  it('normalizeLibrary：同时存在老 universalBox 和新 universalBoxes 时，以 universalBoxes 为准（已迁移过，不重复迁移）', () => {
    const existingBoxes = [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }]
    const staleOldBox = { id: UNIVERSAL_BOX_ID, name: '过期的老字段', cards: [{ type: 'card', attrs: { cardId: 'stale' }, content: [] }] }
    const lib = normalizeLibrary({ books: [], activeBookId: null, universalBoxes: existingBoxes, universalBox: staleOldBox })
    expect(lib.universalBoxes).toEqual(existingBoxes)
  })

  it('normalizeBook 新格式（有 doc）：原样返回，补 boxes', () => {
    const doc = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
    const b = normalizeBook({ id: 'x', title: 't', doc })
    expect(b.doc).toEqual(doc)
    expect(b.boxes).toEqual([])
    const b2 = normalizeBook({ id: 'x', title: 't', doc, boxes: [{ id: 'b1', name: 'n', cards: [] }] })
    expect(b2.boxes).toEqual([{ id: 'b1', name: 'n', cards: [] }])
  })

  it('normalizeBook 旧格式（有 chapters）：迁移成一个大 doc，章标题卡 + 该章卡片依次拼接', () => {
    const cardA = { type: 'card', attrs: { cardId: 'a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }
    const cardB = { type: 'card', attrs: { cardId: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] }
    const raw = {
      id: 'x',
      title: 't',
      chapters: [
        { id: 'c1', title: '一', doc: { type: 'doc', content: [cardA] } },
        { id: 'c2', title: '二', doc: { type: 'doc', content: [cardB] } },
      ],
      threads: [{ id: 'th1', name: '语言', color: '#fff' }],
      boxes: [{ id: 'b1', name: '素材', cards: [] }],
    }
    const b = normalizeBook(raw)
    expect(b.doc.type).toBe('doc')
    expect(b.doc.content).toHaveLength(4)

    const [ch1, gotCardA, ch2, gotCardB] = b.doc.content
    expect(ch1.type).toBe('card')
    expect(ch1.content).toHaveLength(1)
    expect(ch1.content[0].attrs.style).toBe('chapter')
    expect(ch1.content[0].content[0].text).toBe('一')

    expect(gotCardA).toEqual(cardA)

    expect(ch2.type).toBe('card')
    expect(ch2.content[0].attrs.style).toBe('chapter')
    expect(ch2.content[0].content[0].text).toBe('二')

    expect(gotCardB).toEqual(cardB)

    expect(b.boxes).toEqual([{ id: 'b1', name: '素材', cards: [] }])
    expect((b as any).threads).toBeUndefined()
    expect((b as any).chapters).toBeUndefined()
    expect((b as any).activeChapterId).toBeUndefined()
  })

  it('normalizeBook 旧格式：章节标题为空/纯空白时跳过章标题卡，且迁移出的 doc 能被真实 Editor 无错加载（回归：ProseMirror 空文本节点会抛错并拖垮整本书迁移）', () => {
    const cardA = { type: 'card', attrs: { cardId: 'a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }
    const cardB = { type: 'card', attrs: { cardId: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] }
    const raw = {
      id: 'x',
      title: 't',
      chapters: [
        { id: 'c1', title: '', doc: { type: 'doc', content: [cardA] } },
        { id: 'c2', title: '   ', doc: { type: 'doc', content: [cardB] } },
      ],
    }
    const b = normalizeBook(raw)
    expect(b.doc.content).toHaveLength(2)
    expect(b.doc.content[0]).toEqual(cardA)
    expect(b.doc.content[1]).toEqual(cardB)

    expect(() => {
      const editor = new Editor({ extensions: baseExtensions, content: b.doc })
      editor.destroy()
    }).not.toThrow()
  })

  it('normalizeBook 旧格式：章节有有效标题但 doc.content 缺失/为空时不崩溃，只贡献标题卡', () => {
    const raw = {
      id: 'x',
      title: 't',
      chapters: [
        { id: 'c1', title: '第一章' },
        { id: 'c2', title: '第二章', doc: { type: 'doc', content: [] } },
      ],
    }
    const b = normalizeBook(raw)
    expect(b.doc.content).toHaveLength(2)
    expect(b.doc.content[0].content[0].content[0].text).toBe('第一章')
    expect(b.doc.content[1].content[0].content[0].text).toBe('第二章')

    expect(() => {
      const editor = new Editor({ extensions: baseExtensions, content: b.doc })
      editor.destroy()
    }).not.toThrow()
  })

  it('normalizeBook 旧格式缺 boxes 时补空数组', () => {
    const raw = {
      id: 'x',
      title: 't',
      chapters: [{ id: 'c1', title: '一', doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] } }],
    }
    const b = normalizeBook(raw)
    expect(b.boxes).toEqual([])
  })

  it('store 初始化时，若 load() 的迁移结果跟 localStorage 里原始形状不同，立刻落盘（不用等用户下一次改动）', async () => {
    localStorage.clear()
    // 老格式：没有 universalBoxes 字段，且用的是 chapters（老正文格式），两者都会
    // 被 normalizeLibrary/normalizeBook 迁移成新形状。
    const oldFormat = {
      books: [
        {
          id: 'old-book',
          title: '旧书',
          chapters: [{ id: 'c1', title: '第一章', doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] } }],
        },
      ],
      activeBookId: null,
    }
    localStorage.setItem('card-writer:library', JSON.stringify(oldFormat))

    // vi.resetModules() 让下面这次 import 拿到一个全新的模块实例，其内部的
    // useBookStore = create(...) 会重新执行一遍初始化逻辑（包括 load() + 迁移后
    // 立刻 persist 的那段），而不是复用文件顶部早就初始化好的单例。
    vi.resetModules()
    await import('./bookStore')

    const stored = JSON.parse(localStorage.getItem('card-writer:library')!)
    // 迁移后的形状已经落盘：universalBoxes 补上了，books[0] 也从 chapters 变成了 doc。
    expect(stored.universalBoxes).toBeDefined()
    expect(Array.isArray(stored.universalBoxes)).toBe(true)
    expect(stored.books[0].doc).toBeDefined()
    expect(stored.books[0].chapters).toBeUndefined()
  })

  it('store 初始化时，若 localStorage 里已经是当前形状：不做多余的落盘（对象内容不变）', async () => {
    localStorage.clear()
    const current = { books: [{ id: 'b1', title: '书', doc: EMPTY_DOC, boxes: [], updatedAt: '2026-01-01T00:00:00.000Z' }], activeBookId: null, universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }] }
    const raw = JSON.stringify(current)
    localStorage.setItem('card-writer:library', raw)

    vi.resetModules()
    await import('./bookStore')

    // 已经是当前形状——内容应该原样不变（哪怕内部又 setItem 了一次，字符串也该完全一致）。
    expect(localStorage.getItem('card-writer:library')).toBe(raw)
  })
})

// 自定义封面（Cover）：新增的可选属性，DATA-SAFETY 铁律要求——没设置过封面的
// 书（老数据、新建的书）表现必须跟改动前完全一致；一本书的 doc/boxes/卡片
// 数量不能因为这批改动少一张。
describe('bookStore — 自定义封面 cover', () => {
  const cover: Cover = { colors: ['#111111', '#222222', '#333333'], angle: 200, texture: false }

  it('isValidCover：三个字符串颜色 + 可选 angle(number)/texture(boolean) 才算合法', () => {
    expect(isValidCover(cover)).toBe(true)
    expect(isValidCover({ colors: ['#111', '#222', '#333'] })).toBe(true)
    expect(isValidCover(undefined)).toBe(false)
    expect(isValidCover(null)).toBe(false)
    expect(isValidCover({})).toBe(false)
    expect(isValidCover({ colors: ['#111', '#222'] })).toBe(false) // 只有两个颜色
    expect(isValidCover({ colors: [1, 2, 3] })).toBe(false) // 不是字符串
    expect(isValidCover({ colors: ['#111', '#222', '#333'], angle: 'x' })).toBe(false)
    expect(isValidCover({ colors: ['#111', '#222', '#333'], texture: 'x' })).toBe(false)
  })

  it('setBookCover 给指定书设置 cover、重新盖 updatedAt、并持久化；不碰 doc/boxes', () => {
    const book = useBookStore.getState().addBook('新书')
    const docBefore = book.doc
    const boxesBefore = book.boxes
    useBookStore.getState().setBookCover(book.id, cover)
    const updated = useBookStore.getState().library.books.find((b) => b.id === book.id)!
    expect(updated.cover).toEqual(cover)
    expect(updated.doc).toBe(docBefore)
    expect(updated.boxes).toBe(boxesBefore)
    expect(updated.updatedAt).toBeDefined()
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.books.find((b: any) => b.id === book.id).cover).toEqual(cover)
  })

  it('clearBookCover 清掉 cover，回退到自动渐变（书上不再有 cover 字段）', () => {
    const book = useBookStore.getState().addBook('新书')
    useBookStore.getState().setBookCover(book.id, cover)
    useBookStore.getState().clearBookCover(book.id)
    const updated = useBookStore.getState().library.books.find((b) => b.id === book.id)!
    expect(updated.cover).toBeUndefined()
    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.books.find((b: any) => b.id === book.id).cover).toBeUndefined()
  })

  it('setBookCover 只改目标书，其它书的 cover/doc/boxes 原样不变', () => {
    const bookA = useBookStore.getState().addBook('A')
    const bookB = useBookStore.getState().addBook('B')
    useBookStore.getState().setBookCover(bookA.id, cover)
    const b = useBookStore.getState().library.books.find((x) => x.id === bookB.id)!
    expect(b.cover).toBeUndefined()
    expect(b.doc).toEqual(bookB.doc)
    expect(b.boxes).toEqual(bookB.boxes)
  })

  it('DATA-SAFETY 迁移测试：一批老书（无 cover 字段，带卡片）经 normalizeLibrary 后，每一本书、每一张卡都原样健在，且能正常渲染（cover 缺失不抛出）', () => {
    const oldLib = {
      books: [
        {
          id: 'old-1',
          title: '老书一',
          doc: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '卡片一' }] }] }, { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '卡片二' }] }] }] },
          boxes: [{ id: 'bx1', name: '盒子', cards: [{ type: 'card', attrs: { cardId: 'boxed-1' }, content: [] }] }],
        },
        { id: 'old-2', title: '老书二', doc: EMPTY_DOC, boxes: [] },
      ],
      activeBookId: 'old-1',
    }
    const beforeSnapshot = JSON.parse(JSON.stringify(oldLib.books))

    const lib = normalizeLibrary(oldLib)

    expect(lib.books).toHaveLength(2)
    expect(lib.books).toEqual(beforeSnapshot) // 每本书、每张卡完全不变（cover 缺失不影响其它字段）
    expect(lib.books[0].doc.content).toHaveLength(2) // 两张卡都还在
    expect(lib.books[0].boxes[0].cards).toHaveLength(1) // 盒子里的卡也还在
    expect(lib.books[0].cover).toBeUndefined()
    expect(lib.books[1].cover).toBeUndefined()
  })

  it('normalizeLibrary：带合法 cover 的书 —— cover 原样保留，doc/boxes 不受影响', () => {
    const oldLib = {
      books: [{ id: 'b1', title: '有封面的书', doc: EMPTY_DOC, boxes: [], cover }],
      activeBookId: null,
    }
    const lib = normalizeLibrary(oldLib)
    expect(lib.books[0].cover).toEqual(cover)
    expect(lib.books[0].doc).toEqual(EMPTY_DOC)
  })

  it('normalizeBook：cover 形状不对（脏数据）时丢弃，不抛出，其它字段不受影响', () => {
    expect(() => normalizeBook({ id: 'x', title: 't', doc: EMPTY_DOC, boxes: [], cover: 'not-an-object' })).not.toThrow()
    const b = normalizeBook({ id: 'x', title: 't', doc: EMPTY_DOC, boxes: [], cover: { colors: ['only-one'] } })
    expect(b.cover).toBeUndefined()
    expect(b.doc).toEqual(EMPTY_DOC)
  })
})

describe('normalizeBook 不许丢字段', () => {
  // 这条是回归测试。原来 normalizeBook 用一行显式字段列表，加新字段时没人会
  // 想起来改它——subtitle / author / hints / aiPolicy 四个就是这么被静默丢掉的，
  // 而且残缺版本会经由同步把云端那份也带没。
  it('Book 上的每一个字段都活着穿过一次 normalize', () => {
    const raw = {
      id: 'b1',
      title: '书',
      doc: { type: 'doc', content: [] },
      boxes: [{ id: 'x', name: '盒', cards: [] }],
      updatedAt: '2026-01-01T00:00:00Z',
      cover: { colors: ['#111', '#222', '#333'] as [string, string, string] },
      subtitle: '副标题',
      author: '作者',
      hints: { c0: { genre: 'narrative' as const, genreReason: '', targets: [] } },
      aiPolicy: 'auto' as const,
      verified: { 'hem in': 'ok' as const },
    }
    const out = normalizeBook(raw) as Record<string, unknown>
    const lost = Object.keys(raw).filter((k) => out[k] === undefined)
    expect(lost).toEqual([])
    expect(out.hints).toEqual(raw.hints)
    expect(out.aiPolicy).toBe('auto')
    expect(out.subtitle).toBe('副标题')
  })

  it('整条 load → persist → load 的往返也不丢', () => {
    const lib = {
      books: [{
        id: 'b1', title: '书', doc: { type: 'doc', content: [] }, boxes: [],
        subtitle: '副', author: '者', aiPolicy: 'strict' as const,
        hints: { c0: { genre: 'other' as const, genreReason: '', targets: [] } },
      }],
      activeBookId: null,
      universalBoxes: [],
    }
    const back = normalizeLibrary(JSON.parse(JSON.stringify(lib)))
    expect(back.books[0].hints).toEqual(lib.books[0].hints)
    expect(back.books[0].subtitle).toBe('副')
    expect(back.books[0].author).toBe('者')
    expect(back.books[0].aiPolicy).toBe('strict')
  })
})
