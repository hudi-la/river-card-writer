import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from '../editor/schema'
import { useBookStore, EMPTY_DOC, load, normalizeBook, normalizeLibrary, UNIVERSAL_BOX_ID } from './bookStore'

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

describe('bookStore — 库级通用盒子', () => {
  it('初始 library.universalBox 是空的默认通用盒子', () => {
    const s = useBookStore.getState()
    expect(s.library.universalBox).toEqual({ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] })
  })

  it('parkCard(UNIVERSAL_BOX_ID, card) 进 library.universalBox，不进任何一本书', () => {
    const bookA = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(bookA.id)
    const cardJSON = { type: 'card', attrs: { cardId: 'u1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON)

    const s = useBookStore.getState()
    expect(s.library.universalBox.cards).toEqual([cardJSON])
    expect(s.activeBook()!.boxes).toEqual([])
    expect(s.getBox(UNIVERSAL_BOX_ID)!.cards).toEqual([cardJSON])

    const raw = JSON.parse(localStorage.getItem('card-writer:library')!)
    expect(raw.universalBox.cards).toEqual([cardJSON])
  })

  it('跨书：openBook(A) 后 park 进通用盒子，再 openBook(B)，getBox(UNIVERSAL_BOX_ID) 仍含该卡（全局共享同一实例）', () => {
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

  it('takeCardFromBox(UNIVERSAL_BOX_ID, cardId) 从通用盒子取出并移除', () => {
    const cardJSON = { type: 'card', attrs: { cardId: 'u3' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'take' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON)

    const taken = useBookStore.getState().takeCardFromBox(UNIVERSAL_BOX_ID, 'u3')
    expect(taken).toEqual(cardJSON)
    expect(useBookStore.getState().library.universalBox.cards).toEqual([])
  })

  it('carry/dropCarried 支持通用盒子 id：装载后经 takeCardFromBox 落定，通用盒子少一张', () => {
    const cardJSON = { type: 'card', attrs: { cardId: 'u4' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'carry' }] }] }
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON)

    useBookStore.getState().carry(UNIVERSAL_BOX_ID, 'u4')
    expect(useBookStore.getState().carried).toEqual({ boxId: UNIVERSAL_BOX_ID, cardId: 'u4' })

    const taken = useBookStore.getState().takeCardFromBox(UNIVERSAL_BOX_ID, 'u4')
    useBookStore.getState().dropCarried()

    expect(taken).toEqual(cardJSON)
    expect(useBookStore.getState().carried).toBeNull()
    expect(useBookStore.getState().library.universalBox.cards).toEqual([])
  })

  it('openUniversalBox 切换 shell 为 universal；goToShelf 能从 universal 回到 shelf', () => {
    useBookStore.getState().openUniversalBox()
    expect(useBookStore.getState().shell).toBe('universal')

    useBookStore.getState().goToShelf()
    expect(useBookStore.getState().shell).toBe('shelf')
  })

  it('书内 openBox(UNIVERSAL_BOX_ID) 照常进入 box 视图，getBox 解析到通用盒子', () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    useBookStore.getState().openBox(UNIVERSAL_BOX_ID)

    const s = useBookStore.getState()
    expect(s.viewKind).toBe('box')
    expect(s.activeBoxId).toBe(UNIVERSAL_BOX_ID)
    expect(s.getBox(s.activeBoxId)).toBe(s.library.universalBox)
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

  it('都无 → 空 library：一本新的空书，activeBookId 为 null', () => {
    localStorage.clear()
    const loaded = load()
    expect(loaded.books).toHaveLength(1)
    expect(loaded.books[0].doc).toEqual(EMPTY_DOC)
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
    expect(lib!.books[0].doc).toEqual(EMPTY_DOC)
  })

  it('normalizeLibrary 补全缺失的 books/activeBookId', () => {
    const lib = normalizeLibrary({})
    expect(lib.books).toEqual([])
    expect(lib.activeBookId).toBeNull()
  })

  it('normalizeLibrary 对无 universalBox 的老库补默认，且 books 原样保留（byte-identical，一律不动）', () => {
    const oldLib = {
      books: [
        { id: 'b1', title: '书一', doc: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] }] }, boxes: [{ id: 'bx1', name: '素材', cards: [{ type: 'card', attrs: { cardId: 'y' }, content: [] }] }] },
        { id: 'b2', title: '书二', doc: EMPTY_DOC, boxes: [] },
      ],
      activeBookId: 'b1',
    }
    const beforeSnapshot = JSON.parse(JSON.stringify(oldLib.books))

    const lib = normalizeLibrary(oldLib)

    expect(lib.universalBox).toEqual({ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] })
    expect(lib.books).toEqual(beforeSnapshot)
    expect(lib.activeBookId).toBe('b1')
    // 传入的原始对象本身也没被 mutate。
    expect(oldLib.books).toEqual(beforeSnapshot)
  })

  it('normalizeLibrary 已有合法 universalBox 时原样保留（不重建、不清空已有卡）', () => {
    const existingBox = { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [{ type: 'card', attrs: { cardId: 'kept' }, content: [] }] }
    const lib = normalizeLibrary({ books: [], activeBookId: null, universalBox: existingBox })
    expect(lib.universalBox).toEqual(existingBox)
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
})
