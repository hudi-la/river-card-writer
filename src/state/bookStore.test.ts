import { describe, it, expect, beforeEach } from 'vitest'
import { useBookStore, EMPTY_DOC, load, THREAD_PALETTE, normalizeBook } from './bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

describe('bookStore', () => {
  it('初始有一本书、一个章、章里是空 doc', () => {
    const s = useBookStore.getState()
    expect(s.book.chapters.length).toBe(1)
    expect(s.getActiveChapter().doc).toEqual(EMPTY_DOC)
  })
  it('addChapter 增加一章并可切换', () => {
    useBookStore.getState().addChapter('第二章')
    const s = useBookStore.getState()
    expect(s.book.chapters.length).toBe(2)
    const second = s.book.chapters[1]
    s.setActiveChapter(second.id)
    expect(useBookStore.getState().activeChapterId).toBe(second.id)
  })
  it('updateChapterDoc 写入并持久化到 localStorage', () => {
    const s = useBookStore.getState()
    const id = s.activeChapterId
    const doc = { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }] }
    s.updateChapterDoc(id, doc)
    expect(useBookStore.getState().getActiveChapter().doc).toEqual(doc)
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.chapters.find((c: any) => c.id === id).doc).toEqual(doc)
  })
  it('load() 遇到形状不对但可解析的 JSON 时回退为一本全新的书，而不是抛出', () => {
    localStorage.setItem('card-writer:book', JSON.stringify({ foo: 1 }))
    let book1: ReturnType<typeof load> | undefined
    expect(() => {
      book1 = load()
    }).not.toThrow()
    expect(book1!.chapters.length).toBe(1)
    expect(book1!.chapters[0].id).toBeTruthy()
    expect(book1!.chapters[0].doc).toEqual(EMPTY_DOC)

    localStorage.setItem('card-writer:book', JSON.stringify({ chapters: [] }))
    let book2: ReturnType<typeof load> | undefined
    expect(() => {
      book2 = load()
    }).not.toThrow()
    expect(book2!.chapters.length).toBe(1)
    expect(book2!.chapters[0].id).toBeTruthy()
    expect(book2!.chapters[0].doc).toEqual(EMPTY_DOC)
  })
  it('renameChapter 改名并持久化', () => {
    const s = useBookStore.getState()
    const id = s.activeChapterId
    s.renameChapter(id, '离岸')
    expect(useBookStore.getState().book.chapters.find((c) => c.id === id)!.title).toBe('离岸')
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.chapters.find((c: any) => c.id === id).title).toBe('离岸')
  })
  it('初始 book 有空 threads', () => {
    expect(useBookStore.getState().book.threads).toEqual([])
  })
  it('addThread 建线、取调色板色、持久化、返回它', () => {
    const t = useBookStore.getState().addThread('语言')
    expect(t.name).toBe('语言')
    expect(THREAD_PALETTE).toContain(t.color)
    expect(useBookStore.getState().book.threads).toHaveLength(1)
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.threads[0].name).toBe('语言')
  })
  it('addThread 连建两条取不同色', () => {
    const a = useBookStore.getState().addThread('a')
    const b = useBookStore.getState().addThread('b')
    expect(a.color).not.toBe(b.color)
  })
  it('normalizeBook 给缺 threads 的旧数据补空数组', () => {
    const b = normalizeBook({ id: 'x', title: 't', chapters: [{ id: 'c', title: 'c', doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] } }] })
    expect(b.threads).toEqual([])
  })
  it('getThread 按 id 查找，null 返回 undefined', () => {
    const t = useBookStore.getState().addThread('语言')
    expect(useBookStore.getState().getThread(t.id)).toEqual(t)
    expect(useBookStore.getState().getThread(null)).toBeUndefined()
  })
  it('初始 boxes 为空、viewKind 为 chapter、activeBoxId 为 null', () => {
    const s = useBookStore.getState()
    expect(s.book.boxes).toEqual([])
    expect(s.viewKind).toBe('chapter')
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
  it('openChapter 设置 viewKind 为 chapter 并设 activeChapterId', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().openBox(box.id)
    const chapterId = useBookStore.getState().book.chapters[0].id
    useBookStore.getState().openChapter(chapterId)
    const s = useBookStore.getState()
    expect(s.viewKind).toBe('chapter')
    expect(s.activeChapterId).toBe(chapterId)
  })
  it('parkCard 把 cardJSON 追加进盒并持久化', () => {
    const box = useBookStore.getState().addBox('素材')
    const cardJSON = { type: 'card', attrs: { cardId: 'c1', threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
    useBookStore.getState().parkCard(box.id, cardJSON)
    const b = useBookStore.getState().getBox(box.id)
    expect(b!.cards).toEqual([cardJSON])
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.boxes.find((x: any) => x.id === box.id).cards).toEqual([cardJSON])
  })
  it('takeCardFromBox 移除并返回该卡，盒里少一张，且持久化', () => {
    const box = useBookStore.getState().addBox('素材')
    const cardJSON = { type: 'card', attrs: { cardId: 'c1', threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
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
  it('normalizeBook 给缺 boxes 的旧数据补空数组', () => {
    const b = normalizeBook({ id: 'x', title: 't', chapters: [{ id: 'c', title: 'c', doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] } }] })
    expect(b.boxes).toEqual([])
  })
})
