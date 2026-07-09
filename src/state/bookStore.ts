import { create } from 'zustand'
import { nanoid } from 'nanoid'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const OLD_BOOK_KEY = 'card-writer:book'
const LIBRARY_KEY = 'card-writer:library'

export type Box = { id: string; name: string; cards: any[] }
export type Book = { id: string; title: string; doc: any; boxes: Box[] }
export type Library = { books: Book[]; activeBookId: string | null }

type BookState = {
  library: Library
  shell: 'shelf' | 'book'
  viewKind: 'doc' | 'box'
  activeBoxId: string | null
  carried: { boxId: string; cardId: string } | null
  activeBook: () => Book | undefined
  addBook: (title?: string) => Book
  openBook: (id: string) => void
  goToShelf: () => void
  renameBook: (id: string, title: string) => void
  deleteBook: (id: string) => void
  updateDoc: (doc: object) => void
  openDoc: () => void
  addBox: (name: string) => Box | undefined
  openBox: (id: string) => void
  parkCard: (boxId: string, cardJSON: any) => void
  takeCardFromBox: (boxId: string, cardId: string) => any | undefined
  getBox: (id: string | null) => Box | undefined
  carry: (boxId: string, cardId: string) => void
  cancelCarry: () => void
  dropCarried: () => void
  __resetForTest: () => void
}

function freshBook(title?: string): Book {
  return { id: nanoid(), title: title ?? '未命名', doc: structuredClone(EMPTY_DOC), boxes: [] }
}

// 把一章的段落文本拼成一张"章标题卡"：card > paragraph(style:'chapter', text: chapter.title)。
function chapterTitleCard(title: string) {
  return {
    type: 'card',
    content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: title }] }],
  }
}

export function normalizeBook(raw: any): Book {
  const boxes: Box[] = Array.isArray(raw.boxes) ? raw.boxes : []
  if (raw.doc) {
    return { id: raw.id, title: raw.title, doc: raw.doc, boxes }
  }
  // 旧格式迁移：每章 → [章标题卡, ...该章的卡]，顺次拼进一个大 doc。
  const chapters = Array.isArray(raw.chapters) ? raw.chapters : []
  const content: any[] = []
  for (const ch of chapters) {
    // 空文本节点会让 ProseMirror 在加载时抛错（"Empty text nodes are not
    // allowed"），进而拖垮整本书的迁移。标题为空/纯空白/缺失时跳过标题卡，
    // 该章的卡片正文照常拼入。
    const title = typeof ch.title === 'string' ? ch.title.trim() : ''
    if (title) content.push(chapterTitleCard(title))
    const chapterCards = Array.isArray(ch.doc?.content) ? ch.doc.content : []
    content.push(...chapterCards)
  }
  const doc = content.length > 0 ? { type: 'doc', content } : structuredClone(EMPTY_DOC)
  return { id: raw.id, title: raw.title, doc, boxes }
}

export function normalizeLibrary(raw: any): Library {
  const books: Book[] = Array.isArray(raw?.books) ? raw.books.map(normalizeBook) : []
  const activeBookId = typeof raw?.activeBookId === 'string' ? raw.activeBookId : null
  return { books, activeBookId }
}

function loadOldSingleBookAsLibrary(): Library | undefined {
  try {
    const raw = localStorage.getItem(OLD_BOOK_KEY)
    if (!raw) return undefined
    const b = JSON.parse(raw)
    const looksLikeBook = b && (b.doc || (Array.isArray(b.chapters) && b.chapters.length > 0 && b.chapters[0]?.id))
    if (!looksLikeBook) return undefined
    return { books: [normalizeBook(b)], activeBookId: null }
  } catch {
    return undefined
  }
}

export function load(): Library {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.books)) return normalizeLibrary(parsed)
    }
  } catch {}

  const migrated = loadOldSingleBookAsLibrary()
  if (migrated) return migrated

  return { books: [freshBook()], activeBookId: null }
}

function persist(library: Library) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library))
  } catch (e) {
    console.warn('persist failed', e)
  }
}

export const useBookStore = create<BookState>((set, get) => {
  const initialLibrary = load()

  function withActiveBook<T>(mutate: (book: Book) => { book: Book; result: T }): T | undefined {
    const book = get().activeBook()
    if (!book) return undefined
    const { book: updated, result } = mutate(book)
    const library = { ...get().library, books: get().library.books.map((b) => (b.id === book.id ? updated : b)) }
    persist(library)
    set({ library })
    return result
  }

  return {
    library: initialLibrary,
    shell: 'shelf',
    viewKind: 'doc',
    activeBoxId: null,
    carried: null,

    activeBook: () => get().library.books.find((b) => b.id === get().library.activeBookId),

    addBook: (title) => {
      const book = freshBook(title)
      const library = { ...get().library, books: [...get().library.books, book] }
      persist(library)
      set({ library })
      return book
    },
    openBook: (id) => set({ library: { ...get().library, activeBookId: id }, shell: 'book', viewKind: 'doc', activeBoxId: null, carried: null }),
    goToShelf: () => set({ shell: 'shelf' }),
    renameBook: (id, title) => {
      const library = { ...get().library, books: get().library.books.map((b) => (b.id === id ? { ...b, title } : b)) }
      persist(library)
      set({ library })
    },
    deleteBook: (id) => {
      const cur = get().library
      const books = cur.books.filter((b) => b.id !== id)
      const wasActive = cur.activeBookId === id
      const library = { books, activeBookId: wasActive ? null : cur.activeBookId }
      persist(library)
      set(wasActive ? { library, shell: 'shelf', viewKind: 'doc', activeBoxId: null, carried: null } : { library })
    },

    updateDoc: (doc) => {
      withActiveBook((book) => ({ book: { ...book, doc }, result: undefined }))
    },
    openDoc: () => set({ viewKind: 'doc' }),
    addBox: (name) => {
      const box: Box = { id: nanoid(), name, cards: [] }
      return withActiveBook((book) => ({ book: { ...book, boxes: [...book.boxes, box] }, result: box }))
    },
    openBox: (id) => set({ viewKind: 'box', activeBoxId: id }),
    parkCard: (boxId, cardJSON) => {
      withActiveBook((book) => ({
        book: { ...book, boxes: book.boxes.map((b) => (b.id === boxId ? { ...b, cards: [...b.cards, cardJSON] } : b)) },
        result: undefined,
      }))
    },
    takeCardFromBox: (boxId, cardId) => {
      const book = get().activeBook()
      if (!book) return undefined
      const box = book.boxes.find((b) => b.id === boxId)
      const card = box?.cards.find((c) => c?.attrs?.cardId === cardId)
      if (!box || !card) return undefined
      return withActiveBook((b) => ({
        book: { ...b, boxes: b.boxes.map((x) => (x.id === boxId ? { ...x, cards: x.cards.filter((c) => c !== card) } : x)) },
        result: card,
      }))
    },
    getBox: (id) => {
      if (!id) return undefined
      return get().activeBook()?.boxes.find((b) => b.id === id)
    },
    carry: (boxId, cardId) => {
      // Non-destructive: the card stays in the box until the moment of drop.
      // Just replacing the reference here is safe — nothing was ever removed.
      set({ carried: { boxId, cardId } })
      get().openDoc()
    },
    cancelCarry: () => {
      // Card was never removed from the box, so there's nothing to put back.
      set({ carried: null })
    },
    dropCarried: () => set({ carried: null }),
    __resetForTest: () => {
      const book = freshBook()
      const library: Library = { books: [book], activeBookId: null }
      persist(library)
      set({ library, shell: 'shelf', viewKind: 'doc', activeBoxId: null, carried: null })
    },
  }
})
