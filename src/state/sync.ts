import type { Book, Library } from './bookStore'

// cw_books 表行形状（见 Task 1 计划）：id uuid, owner uuid, title text, data jsonb({doc,boxes}), position int, updated_at。
export type CwBookRow = {
  id: string
  owner: string
  title: string
  data: { doc: any; boxes: Book['boxes'] }
  position: number
  updated_at: string
}

export function rowToBook(row: CwBookRow): Book {
  return { id: row.id, title: row.title, doc: row.data.doc, boxes: row.data.boxes ?? [] }
}

export function bookToRow(book: Book, ownerId: string, position: number): CwBookRow {
  return {
    id: book.id,
    owner: ownerId,
    title: book.title,
    data: { doc: book.doc, boxes: book.boxes },
    position,
    updated_at: new Date().toISOString(),
  }
}

// 本地 nanoid 不是合法 uuid，首次上传前换成 uuid。优先用运行时的 crypto.randomUUID
// （浏览器 + 现代 Node/jsdom 都有），没有的话退化成手写 v4，纯本地场景够用。
function genUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export type FirstSyncPlan = {
  upload: Book[]
  download: Book[]
  idRemap: Record<string, string>
}

// 首登迁移规则：云有数据 → 云为准（download，本地只当缓存，不 upload）；
// 云空 + 本地有书 → 全部 upload（本地不会被空云覆盖丢失），本地 id 换成 uuid 并记 idRemap；
// 两边都空 → 全空。
export function firstSyncPlan(localBooks: Book[], cloudRows: CwBookRow[]): FirstSyncPlan {
  if (cloudRows.length > 0) {
    return { upload: [], download: cloudRows.map(rowToBook), idRemap: {} }
  }
  if (localBooks.length > 0) {
    const idRemap: Record<string, string> = {}
    const upload = localBooks.map((b) => {
      const newId = genUuid()
      idRemap[b.id] = newId
      return { ...b, id: newId }
    })
    return { upload, download: [], idRemap }
  }
  return { upload: [], download: [], idRemap: {} }
}

// sync 只用到 supabase client 的这一小片接口，方便测试注入 mock；真实
// SupabaseClient 结构上完全满足（PostgrestFilterBuilder 是 thenable）。
export type SyncSupabaseClient = {
  from: (table: string) => {
    select: (columns?: string) => PromiseLike<{ data: CwBookRow[] | null; error: { message: string } | null }>
    upsert: (
      rows: CwBookRow | CwBookRow[]
    ) => PromiseLike<{ error: { message: string } | null }>
    delete: () => { eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }> }
  }
}

// sync 只用到 bookStore 的这一小片接口（getState/setState/subscribe 都是
// zustand store 挂在 hook 函数上的方法），方便测试注入独立的 store 实例。
export type SyncableBookStore = {
  getState: () => { library: Library; setLibrary: (library: Library) => void }
  subscribe: (listener: (state: { library: Library }, prevState: { library: Library }) => void) => () => void
}

export type StartSyncOptions = {
  debounceMs?: number
}

const TABLE = 'cw_books'

export function startSync(
  store: SyncableBookStore,
  client: SyncSupabaseClient | null,
  ownerId: string | null | undefined,
  opts: StartSyncOptions = {}
): () => void {
  if (!client || !ownerId) return () => {}
  // 收窄一次后固定成不为空的局部引用：下面这些嵌套函数是闭包，TS 不会记住
  // 外层参数在 guard 之后就一直非空，所以显式存一份非空的局部变量。
  const cl: SyncSupabaseClient = client
  const owner: string = ownerId

  let stopped = false
  let applyingRemote = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const pendingUpserts = new Map<string, Book>()
  const pendingDeletes = new Set<string>()
  let unsubscribeStore: (() => void) | null = null

  function setLibraryLocally(library: Library) {
    applyingRemote = true
    try {
      store.getState().setLibrary(library)
    } finally {
      applyingRemote = false
    }
  }

  function scheduleFlush() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void flush()
    }, opts.debounceMs ?? 800)
  }

  async function flush() {
    const upserts = Array.from(pendingUpserts.values())
    pendingUpserts.clear()
    const deletes = Array.from(pendingDeletes.values())
    pendingDeletes.clear()

    if (upserts.length > 0) {
      const books = store.getState().library.books
      const rows = upserts.map((b) => {
        const position = books.findIndex((x) => x.id === b.id)
        return bookToRow(b, owner, position === -1 ? 0 : position)
      })
      await cl.from(TABLE).upsert(rows)
    }
    for (const id of deletes) {
      await cl.from(TABLE).delete().eq('id', id)
    }
  }

  function subscribeToLocalChanges() {
    unsubscribeStore = store.subscribe((state, prevState) => {
      if (stopped || applyingRemote) return
      if (state.library.books === prevState.library.books) return

      const books = state.library.books
      const prevBooks = prevState.library.books
      const prevIds = new Set(prevBooks.map((b) => b.id))
      const curIds = new Set(books.map((b) => b.id))

      for (const id of prevIds) {
        if (!curIds.has(id)) {
          pendingDeletes.add(id)
          pendingUpserts.delete(id)
        }
      }
      for (const b of books) {
        const prev = prevBooks.find((p) => p.id === b.id)
        if (prev !== b) {
          pendingUpserts.set(b.id, b)
          pendingDeletes.delete(b.id)
        }
      }
      scheduleFlush()
    })
  }

  async function init() {
    const { data } = await cl.from(TABLE).select('*')
    if (stopped) return
    const cloudRows = data ?? []
    const localBooks = store.getState().library.books
    const plan = firstSyncPlan(localBooks, cloudRows)

    if (cloudRows.length > 0) {
      setLibraryLocally({ books: plan.download, activeBookId: null })
    } else if (plan.upload.length > 0) {
      const cur = store.getState().library
      const remappedBooks = cur.books.map((b) => ({ ...b, id: plan.idRemap[b.id] ?? b.id }))
      const remappedActiveId = cur.activeBookId ? plan.idRemap[cur.activeBookId] ?? cur.activeBookId : cur.activeBookId
      setLibraryLocally({ books: remappedBooks, activeBookId: remappedActiveId })

      const rows = plan.upload.map((b, i) => bookToRow(b, owner, i))
      await cl.from(TABLE).upsert(rows)
    }

    if (!stopped) subscribeToLocalChanges()
  }

  void init()

  return () => {
    stopped = true
    if (debounceTimer) clearTimeout(debounceTimer)
    unsubscribeStore?.()
  }
}
