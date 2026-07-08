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
})
