import { create } from 'zustand'
import { nanoid } from 'nanoid'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const KEY = 'card-writer:book'

export type Chapter = { id: string; title: string; doc: object }
export type Thread = { id: string; name: string; color: string }
export type Book = { id: string; title: string; chapters: Chapter[]; threads: Thread[] }

export const THREAD_PALETTE = ['#7fa3c4', '#d98b7a', '#8bad86', '#d8b46a', '#a98cc4', '#6bb0ad']

type BookState = {
  book: Book
  activeChapterId: string
  addChapter: (title: string) => void
  setActiveChapter: (id: string) => void
  updateChapterDoc: (id: string, doc: object) => void
  renameChapter: (id: string, title: string) => void
  getActiveChapter: () => Chapter
  addThread: (name: string, color?: string) => Thread
  getThread: (id: string | null) => Thread | undefined
  __resetForTest: () => void
}

function freshBook(): Book {
  const ch: Chapter = { id: nanoid(), title: '第一章', doc: structuredClone(EMPTY_DOC) }
  return { id: nanoid(), title: '未命名', chapters: [ch], threads: [] }
}
export function normalizeBook(raw: any): Book {
  return { id: raw.id, title: raw.title, chapters: raw.chapters, threads: Array.isArray(raw.threads) ? raw.threads : [] }
}
export function load(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const b = JSON.parse(raw)
      if (b && Array.isArray(b.chapters) && b.chapters.length > 0 && b.chapters[0]?.id) return normalizeBook(b)
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
    addThread: (name, color) => {
      const used = new Set(get().book.threads.map((t) => t.color))
      const auto = THREAD_PALETTE.find((c) => !used.has(c)) ?? THREAD_PALETTE[get().book.threads.length % THREAD_PALETTE.length]
      const thread: Thread = { id: nanoid(), name, color: color ?? auto }
      const book = { ...get().book, threads: [...get().book.threads, thread] }
      persist(book)
      set({ book })
      return thread
    },
    getThread: (id) => (id ? get().book.threads.find((t) => t.id === id) : undefined),
    __resetForTest: () => {
      const book = freshBook()
      persist(book)
      set({ book, activeChapterId: book.chapters[0].id })
    },
  }
})
