import { useSaveStatus } from './saveStatus'
import type { Book, Box, Cover, Library } from './bookStore'
import { UNIVERSAL_BOX_ID, isValidCover, isPristineStarter } from './bookStore'
import { mergeUniversalCards } from './backup'

// cw_books 表行形状：id uuid, owner uuid, title text, data jsonb({doc,boxes}), position int,
// updated_at, cover jsonb（可空，独立于 data 之外的一列——封面变更从不touch data 里的
// doc/boxes，迁移是纯加列、老行 cover 一律是 null，rowToBook 把 null/不合法形状都当
// "没有封面"处理）。
export type CwBookRow = {
  id: string
  owner: string
  title: string
  data: { doc: any; boxes: Book['boxes']; subtitle?: string; author?: string; hints?: Book['hints']; aiPolicy?: Book['aiPolicy']; verified?: Book['verified']; used?: Book['used']; settled?: Book['settled']; translations?: Book['translations'] }
  position: number
  updated_at: string
  cover?: Cover | null
}

export function rowToBook(row: CwBookRow): Book {
  return {
    id: row.id,
    title: row.title,
    doc: row.data.doc,
    boxes: row.data.boxes ?? [],
    updatedAt: row.updated_at,
    cover: isValidCover(row.cover) ? row.cover : undefined,
    ...(typeof row.data.subtitle === 'string' ? { subtitle: row.data.subtitle } : {}),
    ...(typeof row.data.author === 'string' ? { author: row.data.author } : {}),
    // 备料提词与档位：老行没有这两个 key，读出来就是 undefined，行为零变化。
    ...(row.data.hints && typeof row.data.hints === 'object' ? { hints: row.data.hints } : {}),
    ...(row.data.aiPolicy ? { aiPolicy: row.data.aiPolicy } : {}),
    ...(row.data.verified && typeof row.data.verified === 'object' ? { verified: row.data.verified } : {}),
    ...(row.data.used && typeof row.data.used === 'object' ? { used: row.data.used } : {}),
    ...(row.data.settled && typeof row.data.settled === 'object' ? { settled: row.data.settled } : {}),
    ...(row.data.translations && typeof row.data.translations === 'object' ? { translations: row.data.translations } : {}),
  }
}

export function bookToRow(book: Book, ownerId: string, position: number): CwBookRow {
  return {
    id: book.id,
    owner: ownerId,
    title: book.title,
    data: {
      doc: book.doc,
      boxes: book.boxes,
      ...(book.subtitle ? { subtitle: book.subtitle } : {}),
      ...(book.author ? { author: book.author } : {}),
      ...(book.hints ? { hints: book.hints } : {}),
      ...(book.aiPolicy ? { aiPolicy: book.aiPolicy } : {}),
      ...(book.verified ? { verified: book.verified } : {}),
      ...(book.used ? { used: book.used } : {}),
      ...(book.settled ? { settled: book.settled } : {}),
      ...(book.translations ? { translations: book.translations } : {}),
    },
    position,
    // 优先用本书自己的 updatedAt（改动发生的真实时间），这样即使这次 upsert
    // 因为网络问题延后了几秒才发出，云端记的还是"用户实际改动"的时间，不会
    // 因为写入延迟而在下次合并时被误判成"更旧"。老书/没走过新 store 逻辑的书
    // 没有 updatedAt 时才退化成"现在"。
    updated_at: book.updatedAt ?? new Date().toISOString(),
    cover: book.cover ?? null,
  }
}

// cw_universal 表行形状：owner uuid（PK，=auth.uid()）, data jsonb, updated_at。
// 每个用户至多一行——通用盒子是库级单例*表*（一行），但 Phase 14 起一行里可以装
// 多个具名通用盒子，data 存的是 Box[] 数组。为了兼容 Phase 14 之前写入的老行
// （data 是单个 {id,name,cards} 对象，不是数组），data 的类型放宽成"数组或老单
// 对象"两种形状都收——rowToUniversal 负责把老形状包成单元素数组读出来。
export type CwUniversalRow = {
  owner: string
  data:
    | Array<{ id: string; name: string; cards: any[]; emoji?: string; color?: string }>
    | { id: string; name: string; cards: any[]; emoji?: string; color?: string }
  updated_at: string
}

export function rowToUniversal(row: CwUniversalRow): Box[] {
  const raw = row.data
  if (Array.isArray(raw)) {
    return raw
      .filter((b) => b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string')
      .map((b) => ({
        id: b.id,
        name: b.name,
        cards: Array.isArray(b.cards) ? b.cards : [],
        ...(typeof b.emoji === 'string' ? { emoji: b.emoji } : {}),
        ...(typeof b.color === 'string' ? { color: b.color } : {}),
      }))
  }
  // 老格式：单个 box 对象，不是数组——包成单元素数组，原样保留 id/name/cards/emoji/color。
  if (raw && typeof raw === 'object') {
    return [
      {
        id: raw.id,
        name: raw.name,
        cards: Array.isArray(raw.cards) ? raw.cards : [],
        ...(typeof raw.emoji === 'string' ? { emoji: raw.emoji } : {}),
        ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
      },
    ]
  }
  return []
}

export function universalToRow(universalBoxes: Box[], ownerId: string): CwUniversalRow {
  return {
    owner: ownerId,
    data: universalBoxes.map((b) => ({ id: b.id, name: b.name, cards: b.cards, ...(b.emoji ? { emoji: b.emoji } : {}), ...(b.color ? { color: b.color } : {}) })),
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

export type BookMergePlan = {
  // sync 完成后，本地 library.books 应该变成的样子——local ∪ cloud，按 book id
  // union，一本都不丢。
  merged: Book[]
  // 需要 upsert 回云端的书：本地独有的（含刚换完 uuid 的）+ 本地版本更新、需要
  // 覆盖云端旧版本的。云端独有、或云端版本更新被采纳的书不出现在这里——没有
  // 理由把云端刚给我们的数据原样传回去。
  toUpload: Book[]
  // 本地非 uuid（老 nanoid）id → 新 uuid 的映射，调用方要用它去重写 activeBookId。
  idRemap: Record<string, string>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

// 把 updatedAt 解析成好比较的毫秒数；缺失/解析不出来一律返回 null（"不确定"），
// 不编造一个哨兵值——调用方看到 null 就知道要走"不确定就优先本地"这条分支。
function parseUpdatedAt(ts: string | undefined): number | null {
  if (!ts) return null
  const t = Date.parse(ts)
  return Number.isNaN(t) ? null : t
}

// 非破坏性合并（书层）：CRITICAL DATA-SAFETY——这是本次要修的那个丢书 bug 的
// 根本修复点。老逻辑是"云非空就整个 download 数组替换本地 books"，云端不知道
// 的本地独有书（还没来得及同步的新书、老的未命名书……）就这么被覆盖丢了。新
// 规则改成按 book id 的 union：
//   - 只有本地 → 保留（老 nanoid id 换成 uuid 记进 idRemap）+ 加进 toUpload。
//   - 只有云端 → 下载进 merged，不需要回传。
//   - 两边都有同 id 的书 → 比 updatedAt，云端严格更新才用云端版本；否则（本地
//     更新，或时间戳缺失/相等/无法比较）一律保留本地版本并重新 upload——"不确
//     定就优先本地"，绝不能因为拿不准就把本地最近的改动/新书丢了。
// 空云端、空本地都是这条通用规则的自然特例（分别退化成"全部本地 upload"、
// "全部云端 download"），不需要再单独判空。
export function mergeBooksPlan(localBooks: Book[], cloudRows: CwBookRow[]): BookMergePlan {
  // 没动过的默认教程书不该污染账号：只要云端或本地还有别的书，就把它从合并里剔掉
  // （既不保留、也不上传）。全空账号（云空 + 本地只有这本教程）时保留它，用户至少有本书看。
  const hasOtherContent = cloudRows.length > 0 || localBooks.some((b) => !isPristineStarter(b))
  const effectiveLocal = hasOtherContent ? localBooks.filter((b) => !isPristineStarter(b)) : localBooks

  const cloudById = new Map(cloudRows.map((r) => [r.id, r]))
  const idRemap: Record<string, string> = {}
  const merged: Book[] = []
  const toUpload: Book[] = []
  const consumedCloudIds = new Set<string>()

  for (const local of effectiveLocal) {
    const cloudRow = cloudById.get(local.id)
    if (cloudRow) {
      consumedCloudIds.add(local.id)
      const localTime = parseUpdatedAt(local.updatedAt)
      const cloudTime = parseUpdatedAt(cloudRow.updated_at)
      const cloudIsStrictlyNewer = localTime !== null && cloudTime !== null && cloudTime > localTime
      if (cloudIsStrictlyNewer) {
        merged.push(rowToBook(cloudRow))
      } else {
        merged.push(local)
        // 本地版本胜出，但如果内容跟云端现有的这行其实一模一样（比如时间戳缺
        // 失只是因为老数据、两边压根没人改过），就没必要每次同步都重新传一遍
        // 一样的东西——只有内容确实不同才需要把本地这版覆盖回云端。
        const cloudAsBook = rowToBook(cloudRow)
        const contentIdentical =
          local.title === cloudAsBook.title &&
          JSON.stringify(bookToRow(local, '', 0).data) === JSON.stringify(cloudRow.data) &&
          JSON.stringify(local.cover ?? null) === JSON.stringify(cloudAsBook.cover ?? null)
        if (!contentIdentical) toUpload.push(local)
      }
    } else if (isUuid(local.id)) {
      // 本地独有，但已经是 uuid（大概率是之前上传过、这次因为网络问题没写进
      // 云端，或者云端那行被别的机制清掉了）——原样保留 id，重新传一次。
      merged.push(local)
      toUpload.push(local)
    } else {
      // 本地独有、还是老 nanoid——从没同步过，换成 uuid 再上传。
      const newId = genUuid()
      idRemap[local.id] = newId
      const remapped = { ...local, id: newId }
      merged.push(remapped)
      toUpload.push(remapped)
    }
  }

  const cloudOnlyRows = cloudRows.filter((r) => !consumedCloudIds.has(r.id)).sort((a, b) => a.position - b.position)
  for (const row of cloudOnlyRows) {
    merged.push(rowToBook(row))
  }

  return { merged, toUpload, idRemap }
}

// Cmd/Ctrl+S 手动强制保存用：不等防抖、不看"有没有脏改动"，直接把当前内存里
// 的全部书 + 全部通用盒子一次性 upsert 回云端。跟 startSync 内部的增量 flush()
// 是两条独立的路径——手动保存这条路径必须对"这本书这次没有被 subscribe 判定
// 为 dirty"这种边缘情况免疫，用户按下 Cmd+S 时心智模型是"现在这一份，原样给我
// 存上"，不是"帮我把还没同步的部分补上"。
// 全程 try/catch 兜底，绝不向调用方抛出——调用方（Cmd+S 处理器）需要在任何情况
// 下都能给出确定的成功/失败反馈，而不是被一个意外抛出打断。
const activeSyncs = new WeakMap<SyncSupabaseClient, { owner: string; flush: () => Promise<FlushResult> }>()

export type FlushResult = { ok: true } | { ok: false; error: string }

export async function flushToCloud(
  client: SyncSupabaseClient | null,
  ownerId: string | null | undefined,
  library: Library
): Promise<FlushResult> {
  if (!client || !ownerId) return { ok: false, error: '未登录，无法保存到云端' }
  const active = activeSyncs.get(client)
  if (active?.owner === ownerId) return active.flush()
  try {
    const books = library.books
    if (books.length > 0) {
      const rows = books.map((b, i) => bookToRow(b, ownerId, i))
      const { error } = await client.from(TABLE).upsert(rows)
      if (error) return { ok: false, error: error.message }
    }
    const { error: universalError } = await client
      .from(UNIVERSAL_TABLE)
      .upsert(universalToRow(library.universalBoxes ?? [], ownerId))
    if (universalError) return { ok: false, error: universalError.message }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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
  safeguard?: (book: Book) => Promise<unknown>
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
  const cl = client, owner = ownerId
  let stopped = false, applyingRemote = false, ready = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<FlushResult> | null = null
  const pendingUpserts = new Map<string, Book>()
  const pendingDeletes = new Set<string>()
  const safeguards = new Map<string, Book>()
  const hasText = (node: any): boolean => !!(node?.type === 'text' && node.text?.trim()) || (node?.content ?? []).some(hasText)
  let pendingUniversal: Box[] | null = null
  let attempt = 0
  const report = (cloud: 'saving' | 'saved' | 'error', cloudError = '') => {
    if (!stopped) useSaveStatus.setState({ cloud, cloudError })
  }
  function setLocal(library: Library) {
    applyingRemote = true
    try { store.getState().setLibrary(library) } finally { applyingRemote = false }
  }
  function schedule(ms = opts.debounceMs ?? 800) {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void flush() }, ms)
  }
  const check = (result: { error: { message: string } | null }) => {
    if (result.error) throw new Error(result.error.message)
  }
  function normalizeIds(library: Library): Library {
    const remap: Record<string, string> = {}
    const books = library.books.map(book => {
      if (isUuid(book.id)) return book
      const id = genUuid(); remap[book.id] = id
      return { ...book, id }
    })
    if (!Object.keys(remap).length) return library
    const next = { ...library, books, activeBookId: library.activeBookId ? remap[library.activeBookId] ?? library.activeBookId : null }
    setLocal(next)
    return store.getState().library
  }
  // Subscribe BEFORE awaiting the first download. Edits during login/network
  // delay stay in the outbox and take priority over the downloaded snapshot.
  const unsubscribe = store.subscribe((state, prev) => {
    if (stopped || applyingRemote) return
    const library = normalizeIds(state.library)
    const prevById = new Map(prev.library.books.map(b => [b.id, b]))
    const currentIds = new Set(library.books.map(b => b.id))
    if (opts.safeguard) for (const old of prev.library.books) {
      const next = library.books.find(b => b.id === old.id)
      if (hasText(old.doc) && (!next || !hasText(next.doc))) {
        safeguards.set(`${old.id}:${old.updatedAt ?? ''}:${JSON.stringify(old.doc)}`, old)
      }
    }
    for (const book of library.books) {
      if (book !== prevById.get(book.id)) { pendingUpserts.set(book.id, book); pendingDeletes.delete(book.id) }
    }
    for (const book of prev.library.books) if (isUuid(book.id) && !currentIds.has(book.id)) {
      pendingDeletes.add(book.id); pendingUpserts.delete(book.id)
    }
    if (library.universalBoxes !== prev.library.universalBoxes) pendingUniversal = library.universalBoxes
    if (pendingUpserts.size || pendingDeletes.size || pendingUniversal) { report('saving'); schedule() }
  })
  async function initialize() {
    // A failed read is NOT an empty cloud library. No uploads until both reads
    // succeed; never overwrite remote data using a guessed empty baseline.
    const booksResult = await cl.from(TABLE).select('*'); check(booksResult)
    if (stopped) return
    const boxesResult = await cl.from(UNIVERSAL_TABLE).select('*'); check(boxesResult)
    if (stopped) return
    const cur = normalizeIds(store.getState().library)
    const rows = (booksResult.data ?? []) as CwBookRow[]
    const plan = mergeBooksPlan(cur.books, rows.filter(r => !pendingDeletes.has(r.id) && !pendingUpserts.has(r.id)))
    if (opts.safeguard) for (const book of plan.toUpload) {
      const oldRow = rows.find(row => row.id === book.id)
      if (oldRow && hasText(oldRow.data.doc) && !hasText(book.doc)) {
        const old = rowToBook(oldRow)
        safeguards.set(`${old.id}:${old.updatedAt ?? ''}:${JSON.stringify(old.doc)}`, old)
      }
    }
    const cloudBox = (boxesResult.data ?? [])[0] as CwUniversalRow | undefined
    const boxes = mergeUniversalBoxes(cur.universalBoxes ?? defaultUniversalBoxes(), cloudBox ? rowToUniversal(cloudBox) : [])
    setLocal({ ...cur, books: plan.merged, universalBoxes: boxes,
      activeBookId: cur.activeBookId && plan.merged.some(b => b.id === cur.activeBookId) ? cur.activeBookId : null })
    for (const book of plan.toUpload) if (!pendingDeletes.has(book.id)) pendingUpserts.set(book.id, book)
    // setLibrary may recover another tab's independently persisted new books.
    for (const book of store.getState().library.books) if (!rows.some(r => r.id === book.id)) pendingUpserts.set(book.id, book)
    if (!cloudBox || JSON.stringify(boxes) !== JSON.stringify(rowToUniversal(cloudBox))) pendingUniversal = boxes
    ready = true
  }
  async function drain(): Promise<FlushResult> {
    try {
      report('saving')
      if (!ready) await initialize()
      if (stopped) return { ok: false, error: '同步已停止' }
      // One request at a time. A late acknowledgement may remove only the exact
      // queued version it sent, never edits made while that request was in flight.
      while (!stopped && (pendingUpserts.size || pendingDeletes.size || pendingUniversal || safeguards.size)) {
        // A destructive write cannot reach the cloud until its prior full book
        // is durably recoverable, independently of the ordinary five-minute history.
        for (const [key, book] of [...safeguards]) {
          await opts.safeguard!(book)
          if (stopped) return { ok: false, error: '同步已停止' }
          safeguards.delete(key)
        }
        if (safeguards.size) continue
        const sent = [...pendingUpserts.values()]
        if (sent.length) {
          const books = store.getState().library.books
          check(await cl.from(TABLE).upsert(sent.map(b => bookToRow(b, owner, Math.max(0, books.findIndex(x => x.id === b.id))))))
          for (const b of sent) if (pendingUpserts.get(b.id) === b) pendingUpserts.delete(b.id)
        }
        if (stopped) break
        for (const id of [...pendingDeletes]) {
          check(await cl.from(TABLE).delete().eq('id', id))
          pendingDeletes.delete(id)
          if (stopped) break
        }
        if (stopped) break
        const boxes = pendingUniversal
        if (boxes) {
          check(await cl.from(UNIVERSAL_TABLE).upsert(universalToRow(boxes, owner)))
          if (pendingUniversal === boxes) pendingUniversal = null
        }
      }
      attempt = 0
      if (stopped) return { ok: false, error: '同步已停止' }
      report('saved')
      return { ok: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      report('error', error)
      // Keep the outbox intact for returned API errors AND rejected requests.
      schedule(Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)))
      return { ok: false, error }
    }
  }
  function flush(): Promise<FlushResult> {
    if (stopped) return Promise.resolve({ ok: false, error: '同步已停止' })
    if (running) return running
    if (timer) { clearTimeout(timer); timer = null }
    running = drain().finally(() => { running = null })
    return running
  }
  activeSyncs.set(cl, { owner, flush })
  useSaveStatus.setState({ retry: flush })
  const onOnline = () => { void flush() }
  const onHidden = () => { if (document.visibilityState === 'hidden') void flush() }
  const onUnload = (event: BeforeUnloadEvent) => {
    if (pendingUpserts.size || pendingDeletes.size || pendingUniversal || useSaveStatus.getState().localError) {
      event.preventDefault(); event.returnValue = ''
    }
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('beforeunload', onUnload)
  void flush()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    unsubscribe()
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('beforeunload', onUnload)
    if (activeSyncs.get(cl)?.flush === flush) {
      activeSyncs.delete(cl)
      useSaveStatus.setState({ cloud: 'idle', cloudError: '', retry: null })
    }
  }
}
