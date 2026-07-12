import type { Book, Box, Library } from './bookStore'
import { UNIVERSAL_BOX_ID } from './bookStore'
import { mergeUniversalCards } from './backup'

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

// cw_universal 表行形状：owner uuid（PK，=auth.uid()）, data jsonb, updated_at。
// 每个用户至多一行——通用盒子是库级单例*表*（一行），但 Phase 14 起一行里可以装
// 多个具名通用盒子，data 存的是 Box[] 数组。为了兼容 Phase 14 之前写入的老行
// （data 是单个 {id,name,cards} 对象，不是数组），data 的类型放宽成"数组或老单
// 对象"两种形状都收——rowToUniversal 负责把老形状包成单元素数组读出来。
export type CwUniversalRow = {
  owner: string
  data: Array<{ id: string; name: string; cards: any[] }> | { id: string; name: string; cards: any[] }
  updated_at: string
}

export function rowToUniversal(row: CwUniversalRow): Box[] {
  const raw = row.data
  if (Array.isArray(raw)) {
    return raw
      .filter((b) => b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string')
      .map((b) => ({ id: b.id, name: b.name, cards: Array.isArray(b.cards) ? b.cards : [] }))
  }
  // 老格式：单个 box 对象，不是数组——包成单元素数组，原样保留 id/name/cards。
  if (raw && typeof raw === 'object') {
    return [{ id: raw.id, name: raw.name, cards: Array.isArray(raw.cards) ? raw.cards : [] }]
  }
  return []
}

export function universalToRow(universalBoxes: Box[], ownerId: string): CwUniversalRow {
  return {
    owner: ownerId,
    data: universalBoxes.map((b) => ({ id: b.id, name: b.name, cards: b.cards })),
    updated_at: new Date().toISOString(),
  }
}

// 非破坏性合并（卡片层）：union，按 attrs.cardId 去重。本地卡永远全部保留（同 id 时
// 本地版本优先，不被云端覆盖）；只把云端有、本地没有的卡追加进来。空云端絶不会删掉
// 本地任何一张卡——这就是通用盒子 CRITICAL DATA-SAFETY 规则在 sync 层的落点。
// 复用 backup.ts 的 mergeUniversalCards——跟"从备份文件导入"用的是同一条已测试过的
// 去重合并逻辑，云同步和本地导入没必要各写一份。
export function mergeUniversal(localCards: any[], cloudCards: any[]): any[] {
  return mergeUniversalCards(localCards, cloudCards)
}

// 非破坏性合并（盒子层）：按 box id union——本地有的盒子保留（同 id 时用上面的
// mergeUniversal 按 cardId union 合并两边的卡，本地卡永远保留、云端独有的卡追加）；
// 云端有而本地没有的盒子（比如在另一台设备上新建的通用盒子）整个追加进来。空云端
// 不会删掉本地任何一个盒子或任何一张卡。
export function mergeUniversalBoxes(localBoxes: Box[], cloudBoxes: Box[]): Box[] {
  const cloudById = new Map(cloudBoxes.map((b) => [b.id, b]))
  const merged: Box[] = localBoxes.map((lb) => {
    const cb = cloudById.get(lb.id)
    if (cb) cloudById.delete(lb.id)
    if (!cb) return lb
    return { ...lb, cards: mergeUniversal(lb.cards, cb.cards) }
  })
  for (const cb of cloudById.values()) {
    merged.push({ id: cb.id, name: cb.name, cards: cb.cards })
  }
  return merged
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
// select/upsert 的行类型放宽成 any[]/any——同一个 client 类型现在要同时服务
// cw_books（CwBookRow）和 cw_universal（CwUniversalRow）两张表，`from(table)`
// 按表名返回的形状不同，这里不为具体某张表的行形状收窄。
export type SyncSupabaseClient = {
  from: (table: string) => {
    select: (columns?: string) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>
    upsert: (rows: any) => PromiseLike<{ error: { message: string } | null }>
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
const UNIVERSAL_TABLE = 'cw_universal'

function defaultUniversalBoxes(): Box[] {
  return [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }]
}

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
  // 通用盒子是库级单行，跟按 id 增量追踪的 books 不一样——只需记"最新一份要传的
  // universalBoxes 数组"，防抖窗口内多次改动自然合并成一次 upsert。
  let pendingUniversalUpsert: Box[] | null = null
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
    const universalUpsert = pendingUniversalUpsert
    pendingUniversalUpsert = null

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
    if (universalUpsert) {
      await cl.from(UNIVERSAL_TABLE).upsert(universalToRow(universalUpsert, owner))
    }
  }

  function subscribeToLocalChanges() {
    unsubscribeStore = store.subscribe((state, prevState) => {
      if (stopped || applyingRemote) return
      let dirty = false

      if (state.library.books !== prevState.library.books) {
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
        dirty = true
      }

      if (state.library.universalBoxes !== prevState.library.universalBoxes) {
        pendingUniversalUpsert = state.library.universalBoxes
        dirty = true
      }

      if (dirty) scheduleFlush()
    })
  }

  async function initBooks() {
    const { data } = await cl.from(TABLE).select('*')
    if (stopped) return
    const cloudRows = (data ?? []) as CwBookRow[]
    const localBooks = store.getState().library.books
    const plan = firstSyncPlan(localBooks, cloudRows)

    if (cloudRows.length > 0) {
      setLibraryLocally({ ...store.getState().library, books: plan.download, activeBookId: null })
    } else if (plan.upload.length > 0) {
      const cur = store.getState().library
      const remappedBooks = cur.books.map((b) => ({ ...b, id: plan.idRemap[b.id] ?? b.id }))
      const remappedActiveId = cur.activeBookId ? plan.idRemap[cur.activeBookId] ?? cur.activeBookId : cur.activeBookId
      setLibraryLocally({ ...cur, books: remappedBooks, activeBookId: remappedActiveId })

      const rows = plan.upload.map((b, i) => bookToRow(b, owner, i))
      await cl.from(TABLE).upsert(rows)
    }
  }

  // 通用盒子：至多一行/用户，一行里装 Box[]（多个具名通用盒子）。云有行 → 跟本地
  // 按"每个 box 按 id、cards 按 cardId"做非破坏性 union 合并（mergeUniversalBoxes，
  // 本地盒子/本地卡永远保留），合并结果写回本地 store；云没有行，或合并后跟云端原有
  // 的不一致（本地有云端还不知道的盒子/卡）→ 把合并结果 upsert 回云端，让云端也追上
  // 本地。全程不存在"用云覆盖本地"这条路径——即使云端行存在但本地更全，也只增不减。
  async function initUniversal() {
    const { data } = await cl.from(UNIVERSAL_TABLE).select('*')
    if (stopped) return
    const cloudRow = ((data ?? [])[0] ?? null) as CwUniversalRow | null
    const localBoxes = store.getState().library.universalBoxes ?? defaultUniversalBoxes()
    const cloudBoxes = cloudRow ? rowToUniversal(cloudRow) : []
    const mergedBoxes = mergeUniversalBoxes(localBoxes, cloudBoxes)

    const localSerialized = JSON.stringify(localBoxes)
    const mergedSerialized = JSON.stringify(mergedBoxes)
    if (mergedSerialized !== localSerialized) {
      setLibraryLocally({ ...store.getState().library, universalBoxes: mergedBoxes })
    }
    if (!cloudRow || mergedSerialized !== JSON.stringify(cloudBoxes)) {
      await cl.from(UNIVERSAL_TABLE).upsert(universalToRow(mergedBoxes, owner))
    }
  }

  async function init() {
    await initBooks()
    if (stopped) return
    await initUniversal()
    if (!stopped) subscribeToLocalChanges()
  }

  void init()

  return () => {
    stopped = true
    if (debounceTimer) clearTimeout(debounceTimer)
    unsubscribeStore?.()
  }
}
