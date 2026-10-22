import { renderArticle, type ArticleBook } from '../supabase/functions/_shared/article'
type Statement = { bind: (...values: unknown[]) => Statement; first: <T = any>() => Promise<T | null>; all: <T = any>() => Promise<{ results: T[] }>; run: () => Promise<unknown> }
type Env = { RIVER_SHARES?: { prepare: (sql: string) => Statement }; RIVER_SUPABASE_URL?: string; RIVER_SUPABASE_PUBLISHABLE_KEY?: string }
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' }
const json = (data: unknown, status = 200) => Response.json(data, { status, headers })
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const ID = /^[a-f0-9]{64}$/
const MAX_BYTES = 1024 * 1024
async function limitedBody(req: Request): Promise<string> {
 const reader = req.body?.getReader()
 if (!reader) throw new Error('empty')
 const chunks: Uint8Array[] = []; let size = 0
 while (true) {
  const { done, value } = await reader.read()
  if (done) break
  size += value.length
  if (size > MAX_BYTES) { await reader.cancel(); throw new Error('too_large') }
  chunks.push(value)
 }
 const bytes = new Uint8Array(size); let offset = 0
 for (const part of chunks) { bytes.set(part, offset); offset += part.length }
 return new TextDecoder().decode(bytes)
}
function validDoc(doc: any): boolean {
 if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content) || doc.content.length > 20000) return false
 return doc.content.every((card: any) => card?.type === 'card' && Array.isArray(card.content) &&
  (card.attrs?.en == null || (Array.isArray(card.attrs.en) && card.attrs.en.every((p: any) => typeof p === 'string'))) &&
  card.content.every((p: any) => p?.type === 'paragraph' && (p.content == null || (Array.isArray(p.content) && p.content.every((n: any) => n?.type === 'hardBreak' || (n?.type === 'text' && typeof n.text === 'string'))))))
}
export async function handleShares(req: Request, env: Env): Promise<Response | null> {
 const url = new URL(req.url)
 const publicMatch = url.pathname.match(/^\/s\/([a-f0-9]{64})(\/text)?$/)
 const apiMatch = url.pathname.match(/^\/api\/shares(?:\/([a-f0-9]{64}))?$/)
 if (!publicMatch && !apiMatch) return url.pathname.startsWith('/s/') || url.pathname.startsWith('/api/shares/') ? json({ error: '链接不存在' }, 404) : null
 if (!env.RIVER_SHARES) return json({ error: '分享服务尚未启用' }, 503)
 const db = env.RIVER_SHARES
 try {
  if (publicMatch) {
   if (!['GET', 'HEAD'].includes(req.method)) return json({ error: '不支持此操作' }, 405)
   const row = await db.prepare('SELECT title, body, created_at FROM shares WHERE id = ?').bind(publicMatch[1]).first<{ title: string; body: string; created_at: string }>()
   if (!row) return new Response('此分享链接不存在或已撤销。', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain;charset=utf-8' } })
   if (publicMatch[2]) return new Response(req.method === 'HEAD' ? null : row.body, { headers: { ...headers, 'Content-Type': 'text/plain;charset=utf-8' } })
   const articleBody = row.body.startsWith(row.title + '\n\n') ? row.body.slice(row.title.length + 2) : row.body
   const body = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(row.title)} · River</title><link rel="alternate" type="text/plain" href="/s/${publicMatch[1]}/text" title="完整文章纯文本"><style>body{margin:0;background:#faf9f6;color:#242522;font-family:Georgia,"Songti SC",serif}main{max-width:740px;margin:auto;padding:40px 24px 80px}header{border-bottom:1px solid #deded8;padding-bottom:24px;margin-bottom:32px}h1{font-size:30px;line-height:1.4}p{font-size:18px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}.meta,nav{font:13px/1.7 system-ui;color:#65675f}a{color:#456b7c}footer{margin-top:48px;border-top:1px solid #deded8;padding-top:16px}</style></head><body><main><header><nav>River · 全文分享</nav><h1>${escape(row.title)}</h1><div class="meta">分享于 ${escape(row.created_at)} · 此页为分享时的版本</div><a href="/s/${publicMatch[1]}/text">查看纯文本全文</a></header><article>${articleBody.split('\n\n').map(p => `<p>${escape(p)}</p>`).join('')}</article><footer class="meta">中英文按段落交错。原文后续编辑不会自动更新此页。</footer></main></body></html>`
   return new Response(req.method === 'HEAD' ? null : body, { headers: { ...headers, 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } })
  }
  if (!env.RIVER_SUPABASE_URL || !env.RIVER_SUPABASE_PUBLISHABLE_KEY) return json({ error: '分享登录服务尚未配置' }, 503)
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: '请先登录 River' }, 401)
  const verified = await fetch(`${env.RIVER_SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authorization, apikey: env.RIVER_SUPABASE_PUBLISHABLE_KEY } })
  if (!verified.ok) return json({ error: '登录已失效，请重新登录' }, verified.status >= 500 ? 503 : 401)
  const user: { id?: string } = await verified.json()
  if (!user.id) return json({ error: '无法确认登录身份' }, 401)
  if (req.method === 'GET' && !apiMatch![1]) {
   const bookId = url.searchParams.get('bookId')
   if (!bookId || bookId.length > 200) return json({ error: '缺少文章编号' }, 400)
   const { results } = await db.prepare('SELECT id, title, created_at FROM shares WHERE owner = ? AND book_id = ? ORDER BY created_at DESC').bind(user.id, bookId).all()
   return json({ shares: results })
  }
  if (req.method === 'DELETE' && apiMatch![1] && ID.test(apiMatch![1])) {
   await db.prepare('DELETE FROM shares WHERE id = ? AND owner = ?').bind(apiMatch![1], user.id).run()
   return json({ ok: true })
  }
  if (req.method !== 'POST' || apiMatch![1]) return json({ error: '不支持此操作' }, 405)
  let book: ArticleBook
  try { book = JSON.parse(await limitedBody(req)) } catch (e) { return json({ error: e instanceof Error && e.message === 'too_large' ? '文章超过分享大小限制，请改用全文导出。' : '文章格式无效' }, e instanceof Error && e.message === 'too_large' ? 413 : 400) }
  if (!book || typeof book.id !== 'string' || book.id.length > 200 || typeof book.title !== 'string' || book.title.length > 1000 || !validDoc(book.doc) || (book.subtitle !== undefined && typeof book.subtitle !== 'string') || (book.author !== undefined && typeof book.author !== 'string')) return json({ error: '文章格式无效' }, 400)
  const count = await db.prepare('SELECT count(*) AS count FROM shares WHERE owner = ?').bind(user.id).first<{ count: number }>()
  if ((count?.count ?? 0) >= 100) return json({ error: '最多保留 100 个分享链接，请先撤销旧链接。' }, 409)
  const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  const createdAt = new Date().toISOString()
  const { text, warnings } = renderArticle(book)
  await db.prepare('INSERT INTO shares (id, owner, book_id, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, user.id, book.id, book.title, text, createdAt).run()
  return json({ id, title: book.title, created_at: createdAt, warnings }, 201)
 } catch { return json({ error: '分享服务暂时不可用，请稍后重试' }, 503) }
}
