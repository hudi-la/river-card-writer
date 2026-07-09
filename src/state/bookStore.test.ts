import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from '../editor/schema'
import { useBookStore, EMPTY_DOC, load, normalizeBook } from './bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

describe('bookStore', () => {
  it('初始有一本书、一个大 doc（等价 EMPTY_DOC）、viewKind 为 doc', () => {
    const s = useBookStore.getState()
    expect(s.book.doc).toEqual(EMPTY_DOC)
    expect(s.viewKind).toBe('doc')
  })

  it('updateDoc 写入并持久化到 localStorage', () => {
    const doc = { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }] }
    useBookStore.getState().updateDoc(doc)
    expect(useBookStore.getState().book.doc).toEqual(doc)
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.doc).toEqual(doc)
  })

  it('load() 遇到形状不对但可解析的 JSON 时回退为一本全新的书，而不是抛出', () => {
    localStorage.setItem('card-writer:book', JSON.stringify({ foo: 1 }))
    let book1: ReturnType<typeof load> | undefined
    expect(() => {
      book1 = load()
    }).not.toThrow()
    expect(book1!.doc).toEqual(EMPTY_DOC)
    expect(book1!.boxes).toEqual([])

    localStorage.setItem('card-writer:book', JSON.stringify({ doc: null }))
    let book2: ReturnType<typeof load> | undefined
    expect(() => {
      book2 = load()
    }).not.toThrow()
    expect(book2!.doc).toEqual(EMPTY_DOC)
  })

  it('初始 boxes 为空、viewKind 为 doc、activeBoxId 为 null', () => {
    const s = useBookStore.getState()
    expect(s.book.boxes).toEqual([])
    expect(s.viewKind).toBe('doc')
    expect(s.activeBoxId).toBeNull()
  })

  it('addBox 建盒、持久化、返回它', () => {
    const box = useBookStore.getState().addBox('素材')
    expect(box.name).toBe('素材')
    expect(box.cards).toEqual([])
    expect(useBookStore.getState().book.boxes).toHaveLength(1)
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.boxes[0].name).toBe('素材')
  })

  it('openBox 设置 viewKind 为 box 并设 activeBoxId', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().openBox(box.id)
    const s = useBookStore.getState()
    expect(s.viewKind).toBe('box')
    expect(s.activeBoxId).toBe(box.id)
  })

  it('openDoc 把 viewKind 设回 doc', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().openBox(box.id)
    useBookStore.getState().openDoc()
    expect(useBookStore.getState().viewKind).toBe('doc')
  })

  it('parkCard 把 cardJSON 追加进盒并持久化', () => {
    const box = useBookStore.getState().addBox('素材')
    const cardJSON = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(box.id, cardJSON)
    const b = useBookStore.getState().getBox(box.id)
    expect(b!.cards).toEqual([cardJSON])
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.boxes.find((x: any) => x.id === box.id).cards).toEqual([cardJSON])
  })

  it('takeCardFromBox 移除并返回该卡，盒里少一张，且持久化', () => {
    const box = useBookStore.getState().addBox('素材')
    const cardJSON = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(box.id, cardJSON)
    const taken = useBookStore.getState().takeCardFromBox(box.id, 'c1')
    expect(taken).toEqual(cardJSON)
    const b = useBookStore.getState().getBox(box.id)
    expect(b!.cards).toEqual([])
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.boxes.find((x: any) => x.id === box.id).cards).toEqual([])
  })

  it('takeCardFromBox 找不到卡返回 undefined', () => {
    const box = useBookStore.getState().addBox('素材')
    const taken = useBookStore.getState().takeCardFromBox(box.id, 'nope')
    expect(taken).toBeUndefined()
  })

  it('getBox 按 id 查找，null 返回 undefined', () => {
    const box = useBookStore.getState().addBox('素材')
    expect(useBookStore.getState().getBox(box.id)).toEqual(box)
    expect(useBookStore.getState().getBox(null)).toBeUndefined()
  })

  it('carry(boxId, cardId) 后 carried 非空、viewKind 切回 doc', () => {
    const box = useBookStore.getState().addBox('素材')
    const cardJSON = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(box.id, cardJSON)
    useBookStore.getState().openBox(box.id)
    useBookStore.getState().carry(box.id, 'c1')
    const s = useBookStore.getState()
    expect(s.carried).toEqual({ boxId: box.id, cardId: 'c1' })
    expect(s.viewKind).toBe('doc')
    // Non-destructive: card stays in box until drop.
    expect(useBookStore.getState().getBox(box.id)!.cards).toEqual([cardJSON])
  })

  it('cancelCarry 清空 carried', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().carry(box.id, 'c1')
    useBookStore.getState().cancelCarry()
    expect(useBookStore.getState().carried).toBeNull()
  })

  it('dropCarried 清空 carried', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().carry(box.id, 'c1')
    useBookStore.getState().dropCarried()
    expect(useBookStore.getState().carried).toBeNull()
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
    // No title cards emitted for blank titles — only the two chapters' own cards.
    expect(b.doc.content).toHaveLength(2)
    expect(b.doc.content[0]).toEqual(cardA)
    expect(b.doc.content[1]).toEqual(cardB)

    // Key regression assertion: the migrated doc must load into a real
    // TipTap Editor without throwing "Empty text nodes are not allowed".
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
        { id: 'c1', title: '第一章' }, // doc missing entirely
        { id: 'c2', title: '第二章', doc: { type: 'doc', content: [] } }, // doc.content empty
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
