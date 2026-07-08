import { describe, it, expect, beforeEach } from 'vitest'
import { useBookStore, EMPTY_DOC } from './bookStore'

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
})
