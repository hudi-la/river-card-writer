import { create } from 'zustand'
import { nanoid } from 'nanoid'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const KEY = 'card-writer:book'

export type Chapter = { id: string; title: string; doc: object }
export type Book = { id: string; title: string; chapters: Chapter[] }

type BookState = {
  book: Book
  activeChapterId: string
  addChapter: (title: string) => void
  setActiveChapter: (id: string) => void
  updateChapterDoc: (id: string, doc: object) => void
  renameChapter: (id: string, title: string) => void
  getActiveChapter: () => Chapter
  __resetForTest: () => void
}

function freshBook(): Book {
  const ch: Chapter = { id: nanoid(), title: '第一章', doc: structuredClone(EMPTY_DOC) }
  return { id: nanoid(), title: '未命名', chapters: [ch] }
}
export function load(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const b = JSON.parse(raw)
      if (b && Array.isArray(b.chapters) && b.chapters.length > 0 && b.chapters[0]?.id) return b
    }
  } catch {}
  return freshBook()
}
function persist(book: Book) {
  try {
    localStorage.setItem(KEY, JSON.stringify(book))
  } catch (e) {
    console.warn('persist failed', e)
  }
}

export const useBookStore = create<BookState>((set, get) => {
  const initial = load()
  return {
    book: initial,
    activeChapterId: initial.chapters[0].id,
    addChapter: (title) => {
      const ch: Chapter = { id: nanoid(), title, doc: structuredClone(EMPTY_DOC) }
      const book = { ...get().book, chapters: [...get().book.chapters, ch] }
      persist(book)
      set({ book })
    },
    setActiveChapter: (id) => set({ activeChapterId: id }),
    renameChapter: (id, title) => {
      const trimmed = title.trim()
      if (!trimmed) return
      const book = { ...get().book, chapters: get().book.chapters.map((c) => (c.id === id ? { ...c, title: trimmed } : c)) }
      persist(book)
      set({ book })
    },
    updateChapterDoc: (id, doc) => {
      const book = { ...get().book, chapters: get().book.chapters.map((c) => (c.id === id ? { ...c, doc } : c)) }
      persist(book)
      set({ book })
    },
    getActiveChapter: () => {
      const { book, activeChapterId } = get()
      return book.chapters.find((c) => c.id === activeChapterId) ?? book.chapters[0]
    },
    __resetForTest: () => {
      const book = freshBook()
      persist(book)
      set({ book, activeChapterId: book.chapters[0].id })
    },
  }
})
