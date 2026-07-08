import { describe, it, expect, beforeEach } from 'vitest'
import { useBookStore, EMPTY_DOC, load } from './bookStore'

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
})
