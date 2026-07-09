import { create } from 'zustand'
import { nanoid } from 'nanoid'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const KEY = 'card-writer:book'

export type Box = { id: string; name: string; cards: any[] }
export type Book = { id: string; title: string; doc: any; boxes: Box[] }

type BookState = {
  book: Book
  viewKind: 'doc' | 'box'
  activeBoxId: string | null
  carried: { boxId: string; cardId: string } | null
  updateDoc: (doc: object) => void
  openDoc: () => void
  addBox: (name: string) => Box
  openBox: (id: string) => void
  parkCard: (boxId: string, cardJSON: any) => void
  takeCardFromBox: (boxId: string, cardId: string) => any | undefined
  getBox: (id: string | null) => Box | undefined
  carry: (boxId: string, cardId: string) => void
  cancelCarry: () => void
  dropCarried: () => void
  __resetForTest: () => void
}

function freshBook(): Book {
  return { id: nanoid(), title: '未命名', doc: structuredClone(EMPTY_DOC), boxes: [] }
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

export function load(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const b = JSON.parse(raw)
      if (b && b.doc) return normalizeBook(b)
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
    viewKind: 'doc',
    activeBoxId: null,
    carried: null,
    updateDoc: (doc) => {
      const book = { ...get().book, doc }
      persist(book)
      set({ book })
    },
    openDoc: () => set({ viewKind: 'doc' }),
    addBox: (name) => {
      const box: Box = { id: nanoid(), name, cards: [] }
      const book = { ...get().book, boxes: [...get().book.boxes, box] }
      persist(book)
      set({ book })
      return box
    },
    openBox: (id) => set({ viewKind: 'box', activeBoxId: id }),
    parkCard: (boxId, cardJSON) => {
      const book = { ...get().book, boxes: get().book.boxes.map((b) => (b.id === boxId ? { ...b, cards: [...b.cards, cardJSON] } : b)) }
      persist(book)
      set({ book })
    },
    takeCardFromBox: (boxId, cardId) => {
      const box = get().book.boxes.find((b) => b.id === boxId)
      const card = box?.cards.find((c) => c?.attrs?.cardId === cardId)
      if (!box || !card) return undefined
      const book = { ...get().book, boxes: get().book.boxes.map((b) => (b.id === boxId ? { ...b, cards: b.cards.filter((c) => c !== card) } : b)) }
      persist(book)
      set({ book })
      return card
    },
    getBox: (id) => (id ? get().book.boxes.find((b) => b.id === id) : undefined),
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
      persist(book)
      set({ book, viewKind: 'doc', activeBoxId: null, carried: null })
    },
  }
})
