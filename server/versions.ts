import { validVersionBook, versionContent } from '../src/versions/model'
type Statement = { bind: (...values: unknown[]) => Statement; first: <T = any>() => Promise<T | null>; all: <T = any>() => Promise<{ results: T[] }>; run: () => Promise<unknown> }
type Env = { RIVER_SHARES?: { prepare: (sql: string) => Statement }; RIVER_SUPABASE_URL?: string; RIVER_SUPABASE_PUBLISHABLE_KEY?: string }
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers })
async function readBody(req: Request) {
  const reader = req.body?.getReader()
  if (!reader) throw new Error('empty')
  const parts: Uint8Array[] = []; let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > 1024 * 1024) { await reader.cancel(); throw new Error('large') }
    parts.push(value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return JSON.parse(new TextDecoder().decode(bytes))
}
export async function handleVersions(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/versions')) return null
  const route = url.pathname.match(/^\/api\/versions(?:\/([a-f0-9-]{36}))?$/)
  if (!route) return json({ error: '版本不存在' }, 404)
  try {
    const db = env.RIVER_SHARES
    if (!db || !env.RIVER_SUPABASE_URL || !env.RIVER_SUPABASE_PUBLISHABLE_KEY) return json({ error: '版本历史服务尚未配置' }, 503)
    const authorization = req.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer ')) return json({ error: '请先登录 River' }, 401)
    const verified = await fetch(`${env.RIVER_SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.RIVER_SUPABASE_PUBLISHABLE_KEY } })
    if (!verified.ok) return json({ error: '无法验证登录，请稍后重试或重新登录' }, verified.status >= 500 ? 503 : 401)
    const user = await verified.json() as { id?: string }
    if (!user.id) return json({ error: '无法确认登录身份' }, 401)
    if (req.method === 'GET' && route[1]) {
      const row = await db.prepare('SELECT id, name, kind, created_at, snapshot FROM article_versions WHERE owner = ? AND id = ?').bind(user.id, route[1]).first<any>()
      if (!row) return json({ error: '版本不存在' }, 404)
      const { snapshot, ...meta } = row
      return json({ ...meta, book: JSON.parse(snapshot) })
    }
    if (req.method === 'GET' && !route[1] && url.searchParams.get('recovery') === '1') {
      const offset = Number(url.searchParams.get('offset') || 0)
      if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: '分页无效' }, 400)
      // Include the latest non-empty version even when the newest saved version
      // is blank. Never join across owners or require the live book to exist.
      const { results } = await db.prepare(`WITH candidates AS (
        SELECT id, book_id, created_at, json_extract(snapshot, '$.title') AS title,
          ROW_NUMBER() OVER (PARTITION BY book_id ORDER BY created_at DESC, id DESC) AS rank
        FROM article_versions
        WHERE owner = ? AND EXISTS (
          SELECT 1 FROM json_tree(snapshot, '$.doc')
          WHERE key = 'text' AND type = 'text' AND length(trim(value)) > 0
        )
      ) SELECT id, book_id, created_at, title FROM candidates WHERE rank = 1
        ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ?`).bind(user.id, offset).all()
      return json({ articles: results.slice(0, 50), nextOffset: results.length > 50 ? offset + 50 : null })
    }
    const bookId = url.searchParams.get('bookId')
    if (req.method === 'GET' && !route[1]) {
      if (!bookId || bookId.length > 200) return json({ error: '缺少文章编号' }, 400)
      const { results } = await db.prepare('SELECT id, name, kind, created_at FROM article_versions WHERE owner = ? AND book_id = ? ORDER BY created_at DESC, id DESC').bind(user.id, bookId).all()
      return json({ versions: results })
    }
    if (req.method !== 'POST' || route[1]) return json({ error: '不支持此操作' }, 405)
    let payload: any
    try { payload = await readBody(req) } catch (e) {
      const large = e instanceof Error && e.message === 'large'
      return json({ error: large ? '文章超过版本大小限制（1 MB），请先导出备份。' : '版本格式无效' }, large ? 413 : 400)
    }
    const { book, kind, name } = payload ?? {}
    if (!validVersionBook(book) || !['named', 'auto', 'safety'].includes(kind) || typeof name !== 'string' || !name.trim() || name.length > 100) return json({ error: '版本格式无效' }, 400)
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(versionContent(book)))), b => b.toString(16).padStart(2, '0')).join('')
    if (kind === 'auto') {
      const latest = await db.prepare('SELECT id, name, kind, created_at, fingerprint FROM article_versions WHERE owner = ? AND book_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').bind(user.id, book.id).first<any>()
      if (latest?.fingerprint === fingerprint) { const { fingerprint: _, ...meta } = latest; return json(meta) }
    }
    // Limits never silently delete a user's named versions or restore safeguards.
    const count = await db.prepare("SELECT count(*) AS count FROM article_versions WHERE owner = ? AND book_id = ? AND kind != 'auto'").bind(user.id, book.id).first<{ count: number }>()
    if (kind !== 'auto' && (count?.count ?? 0) >= 1000) return json({ error: '这篇文章已有 1000 个保留版本，请先导出备份。当前内容未被替换。' }, 409)
    const meta = { id: crypto.randomUUID(), name: name.trim(), kind, created_at: new Date().toISOString() }
    await db.prepare('INSERT INTO article_versions (id, owner, book_id, name, kind, created_at, snapshot, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(meta.id, user.id, book.id, meta.name, kind, meta.created_at, JSON.stringify(book), fingerprint).run()
    if (kind === 'auto') await db.prepare("DELETE FROM article_versions WHERE owner = ? AND book_id = ? AND kind = 'auto' AND id NOT IN (SELECT id FROM article_versions WHERE owner = ? AND book_id = ? AND kind = 'auto' ORDER BY created_at DESC, id DESC LIMIT 30)").bind(user.id, book.id, user.id, book.id).run()
    return json(meta, 201)
  } catch { return json({ error: '版本历史暂时不可用，当前文章未被替换，请稍后重试。' }, 503) }
}
