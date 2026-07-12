import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { mergeImported, mergeUniversalCards } from './backup'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const OLD_BOOK_KEY = 'card-writer:book'
const LIBRARY_KEY = 'card-writer:library'

export type Box = { id: string; name: string; cards: any[] }
// updatedAt：本书内容最后一次改动的时间（ISO string），每次改标题/正文/盒子都要
// 重新盖章。sync 层拿它来判断"云端跟本地这本同 id 的书谁更新"——CRITICAL：
// 缺失时（老数据、还没被这次改动碰过）一律当成"比云端旧的都不算数"，交给 sync
// 那边的合并规则去处理（该规则选择在缺失/无法比较时优先本地，绝不因为不确定
// 就丢本地改动）。可选字段，而不是给个假的哨兵日期——不确定就是不确定，别装
// 出一个"很旧"的确定值来源，那样反而可能在别的比较逻辑里被误用。
export type Book = { id: string; title: string; doc: any; boxes: Box[]; updatedAt?: string }
export type Library = { books: Book[]; activeBookId: string | null; universalBoxes: Box[] }

// 库级通用盒子：不属于任何一本书，跨所有书共享同一份实例。Phase 14 起支持
// 多个、可命名的通用盒子（library.universalBoxes: Box[]）。UNIVERSAL_BOX_ID
// 保留作为"默认那个通用盒子"的 id——老数据里唯一的那个通用盒子、以及全新库
// 里自动创建的第一个通用盒子，都用这个 id，这样旧的 UNIVERSAL_BOX_ID 引用
// （比如书内那个"通用盒子"入口）迁移后依然命中同一个盒子。
export const UNIVERSAL_BOX_ID = '__universal__'

function defaultUniversalBox(): Box {
  return { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }
}

function defaultUniversalBoxes(): Box[] {
  return [defaultUniversalBox()]
}

function isValidBox(b: any): b is Box {
  return !!b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.cards)
}

function isValidBoxArray(arr: any): arr is Box[] {
  return Array.isArray(arr) && arr.every(isValidBox)
}

type BookState = {
  library: Library
  shell: 'shelf' | 'book' | 'universal'
  viewKind: 'doc' | 'box'
  activeBoxId: string | null
  carried: { boxId: string; cardId: string } | null
  activeBook: () => Book | undefined
  addBook: (title?: string) => Book
  openBook: (id: string) => void
  goToShelf: () => void
  openUniversalBox: () => void
  renameBook: (id: string, title: string) => void
  deleteBook: (id: string) => void
  // 供 sync 模块使用：整体替换 library 并落盘（首登下载/上传回填 uuid 时用），
  // 绕开各 action 自己的局部更新逻辑，最小侵入地把云同步挂进 store。
  setLibrary: (library: Library) => void
  // 备份导入：只增不减地把 books 并进当前 library 并持久化（合并逻辑见 backup.ts）。
  importBooks: (books: Book[]) => void
  // 通用盒子备份导入：按 cardId 去重地把 cards 并进"默认那个"通用盒子（id 为
  // UNIVERSAL_BOX_ID，找不到就并进第一个）并持久化（合并逻辑见 backup.ts 的
  // mergeUniversalCards）——只增不减，重复导入不产生重复卡。
  importUniversalCards: (cards: any[]) => void
  updateDoc: (doc: object) => void
  openDoc: () => void
  addBox: (name: string) => Box | undefined
  // 新增一个具名通用盒子（库级，跨所有书共享），返回新盒子。
  addUniversalBox: (name: string) => Box
  // 重命名指定 id 的通用盒子；id 不存在时 no-op。
  renameUniversalBox: (id: string, name: string) => void
  // 删除指定 id 的通用盒子；id 不存在时 no-op。允许删到只剩 0 个（跟 deleteBook 对
  // books 的语义一致，不强行兜底一个默认盒子）。
  deleteUniversalBox: (id: string) => void
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
  return { id: nanoid(), title: title ?? '未命名', doc: structuredClone(EMPTY_DOC), boxes: [], updatedAt: new Date().toISOString() }
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
  // 老数据没有 updatedAt 字段——留空（undefined），不编造一个哨兵日期。sync 合并
  // 逻辑里"缺失就当不确定、优先本地"的规则已经保证这不会导致丢书/丢改动。
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
  if (raw.doc) {
    return { id: raw.id, title: raw.title, doc: raw.doc, boxes, updatedAt }
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
  return { id: raw.id, title: raw.title, doc, boxes, updatedAt }
}

export function normalizeLibrary(raw: any): Library {
  const books: Book[] = Array.isArray(raw?.books) ? raw.books.map(normalizeBook) : []
  const activeBookId = typeof raw?.activeBookId === 'string' ? raw.activeBookId : null
  // 迁移优先级（一律不丢老盒子/老卡）：
  //   1. 已有合法 universalBoxes 数组 → 原样保留（不重建实例、不动里面的 box/cards）。
  //   2. 老格式的单个 universalBox → 包成单元素数组，原盒子/卡片实例原样保留。
  //   3. 都没有 → 一个全新的默认通用盒子。
  let universalBoxes: Box[]
  if (isValidBoxArray(raw?.universalBoxes)) {
    universalBoxes = raw.universalBoxes
  } else if (isValidBox(raw?.universalBox)) {
    universalBoxes = [raw.universalBox]
  } else {
    universalBoxes = defaultUniversalBoxes()
  }
  return { books, activeBookId, universalBoxes }
}

function loadOldSingleBookAsLibrary(): Library | undefined {
  try {
    const raw = localStorage.getItem(OLD_BOOK_KEY)
    if (!raw) return undefined
    const b = JSON.parse(raw)
    const looksLikeBook = b && (b.doc || (Array.isArray(b.chapters) && b.chapters.length > 0 && b.chapters[0]?.id))
    if (!looksLikeBook) return undefined
    return { books: [normalizeBook(b)], activeBookId: null, universalBoxes: defaultUniversalBoxes() }
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

  return { books: [freshBook()], activeBookId: null, universalBoxes: defaultUniversalBoxes() }
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
    const { book: mutated, result } = mutate(book)
    // 每次通过这条路径改书（正文/盒子/卡片……）都重新盖 updatedAt 时间戳，供 sync
    // 层的"同 id 书谁更新"判断使用——统一在这一个地方盖章，而不是让每个 action
    // 各自记得盖一遍、容易漏掉。
    const updated = { ...mutated, updatedAt: new Date().toISOString() }
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
    openUniversalBox: () => set({ shell: 'universal' }),
    renameBook: (id, title) => {
      const library = {
        ...get().library,
        books: get().library.books.map((b) => (b.id === id ? { ...b, title, updatedAt: new Date().toISOString() } : b)),
      }
      persist(library)
      set({ library })
    },
    deleteBook: (id) => {
      const cur = get().library
      const books = cur.books.filter((b) => b.id !== id)
      const wasActive = cur.activeBookId === id
      const library = { ...cur, books, activeBookId: wasActive ? null : cur.activeBookId }
      persist(library)
      set(wasActive ? { library, shell: 'shelf', viewKind: 'doc', activeBoxId: null, carried: null } : { library })
    },

    // sync/import 传入的 library 可能是旧算法拼出来的、不知道 universalBoxes 这个字段
    // （比如 cw_books 首登下载/上传回填）。缺失/不合法时兜底沿用当前内存里的
    // universalBoxes，而不是丢掉它——通用盒子是本地专属字段，cw_books 同步暂不覆盖它
    // （cw_universal 同步走的是 setLibrary 之外的合并路径，见 sync.ts）。
    setLibrary: (library) => {
      const incoming = (library as any).universalBoxes
      const merged = { ...library, universalBoxes: isValidBoxArray(incoming) ? incoming : get().library.universalBoxes }
      persist(merged)
      set({ library: merged })
    },
    importBooks: (books) => {
      const merged = mergeImported(get().library, books)
      const library = { ...merged, universalBoxes: get().library.universalBoxes }
      persist(library)
      set({ library })
    },
    importUniversalCards: (cards) => {
      const cur = get().library
      if (cur.universalBoxes.length === 0) return
      const targetIdx = Math.max(0, cur.universalBoxes.findIndex((b) => b.id === UNIVERSAL_BOX_ID))
      const universalBoxes = cur.universalBoxes.map((b, i) =>
        i === targetIdx ? { ...b, cards: mergeUniversalCards(b.cards, cards) } : b
      )
      const library = { ...cur, universalBoxes }
      persist(library)
      set({ library })
    },
    updateDoc: (doc) => {
      withActiveBook((book) => ({ book: { ...book, doc }, result: undefined }))
    },
    openDoc: () => set({ viewKind: 'doc' }),
    addBox: (name) => {
      const box: Box = { id: nanoid(), name, cards: [] }
      return withActiveBook((book) => ({ book: { ...book, boxes: [...book.boxes, box] }, result: box }))
    },
    addUniversalBox: (name) => {
      const box: Box = { id: nanoid(), name, cards: [] }
      const library = { ...get().library, universalBoxes: [...get().library.universalBoxes, box] }
      persist(library)
      set({ library })
      return box
    },
    renameUniversalBox: (id, name) => {
      const library = { ...get().library, universalBoxes: get().library.universalBoxes.map((b) => (b.id === id ? { ...b, name } : b)) }
      persist(library)
      set({ library })
    },
    deleteUniversalBox: (id) => {
      const library = { ...get().library, universalBoxes: get().library.universalBoxes.filter((b) => b.id !== id) }
      persist(library)
      set({ library })
    },
    openBox: (id) => set({ viewKind: 'box', activeBoxId: id }),
    parkCard: (boxId, cardJSON) => {
      const cur = get().library
      const uniIdx = cur.universalBoxes.findIndex((b) => b.id === boxId)
      if (uniIdx !== -1) {
        const universalBoxes = cur.universalBoxes.map((b, i) => (i === uniIdx ? { ...b, cards: [...b.cards, cardJSON] } : b))
        const library = { ...cur, universalBoxes }
        persist(library)
        set({ library })
        return
      }
      withActiveBook((book) => ({
        book: { ...book, boxes: book.boxes.map((b) => (b.id === boxId ? { ...b, cards: [...b.cards, cardJSON] } : b)) },
        result: undefined,
      }))
    },
    takeCardFromBox: (boxId, cardId) => {
      const cur = get().library
      const uniIdx = cur.universalBoxes.findIndex((b) => b.id === boxId)
      if (uniIdx !== -1) {
        const box = cur.universalBoxes[uniIdx]
        const card = box.cards.find((c) => c?.attrs?.cardId === cardId)
        if (!card) return undefined
        const universalBoxes = cur.universalBoxes.map((b, i) => (i === uniIdx ? { ...b, cards: b.cards.filter((c) => c !== card) } : b))
        const library = { ...cur, universalBoxes }
        persist(library)
        set({ library })
        return card
      }
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
      const uni = get().library.universalBoxes.find((b) => b.id === id)
      if (uni) return uni
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
      const library: Library = { books: [book], activeBookId: null, universalBoxes: defaultUniversalBoxes() }
      persist(library)
      set({ library, shell: 'shelf', viewKind: 'doc', activeBoxId: null, carried: null })
    },
  }
})
