import { DatabaseSync } from 'node:sqlite'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { handleShares } from '../../server/shares'
let sqlite: DatabaseSync
let env: Parameters<typeof handleShares>[1]
const sample = { id: 'book-one', title: '文章 <script>alert(1)</script>', boxes: [{ secret: 'PRIVATE MATERIAL' }], doc: { type: 'doc', content: [{ type: 'card', attrs: { en: ['English one', 'English two'], note: 'PRIVATE NOTE' }, content: ['中文一', '中文二'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) }] } }
const req = (path: string, method = 'GET', owner = 'a', body?: unknown) => new Request(`https://river.test${path}`, { method, headers: owner ? { Authorization: `Bearer ${owner}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}) })
beforeEach(() => {
 sqlite = new DatabaseSync(':memory:')
 sqlite.exec(readFileSync('server/shares.sql', 'utf8'))
 env = { RIVER_SUPABASE_URL: 'https://auth.test', RIVER_SUPABASE_PUBLISHABLE_KEY: 'public-test', RIVER_SHARES: { prepare(sql) {
  let values: any[] = []
  const statement: any = { bind(...args: any[]) { values = args; return statement }, async first() { return sqlite.prepare(sql).get(...values) || null }, async all() { return { results: sqlite.prepare(sql).all(...values) } }, async run() { return sqlite.prepare(sql).run(...values) } }
  return statement
 } } }
 vi.stubGlobal('crypto', webcrypto)
 vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: RequestInit) => {
  const token = (options.headers as Record<string, string>).Authorization
  return token === 'Bearer a' || token === 'Bearer b' ? Response.json({ id: token.slice(-1) }) : new Response('', { status: 401 })
 }))
})
afterEach(() => { sqlite.close(); vi.unstubAllGlobals() })
it('creates a real bilingual snapshot, readable without login and escaped in HTML', async () => {
 const created = await handleShares(req('/api/shares', 'POST', 'a', sample), env)
 expect(created?.status).toBe(201)
 const { id } = await created!.json()
 expect(id).toMatch(/^[a-f0-9]{64}$/)
 const text = await (await handleShares(req(`/s/${id}/text`, 'GET', ''), env))!.text()
 expect(text).toContain('中文一\n\nEnglish one\n\n中文二\n\nEnglish two')
 expect(text).not.toContain('PRIVATE')
 const response = await handleShares(req(`/s/${id}`, 'GET', ''), env)
 const html = await response!.text()
 expect(html).toContain('&lt;script&gt;')
 expect(html).not.toContain('<script>')
 expect(response!.headers.get('Cache-Control')).toBe('no-store')
 expect(response!.headers.get('X-Robots-Tag')).toBe('noindex')
 expect(html).toContain(`rel="alternate" type="text/plain" href="/s/${id}/text"`)
 expect(html).not.toContain('nofollow')
 const changed = { ...sample, title: 'New title' }
 await handleShares(req('/api/shares', 'POST', 'a', changed), env)
 expect(await (await handleShares(req(`/s/${id}/text`, 'GET', ''), env))!.text()).toBe(text)
})
it('lists only owner links and another user cannot revoke them', async () => {
 const { id } = await (await handleShares(req('/api/shares', 'POST', 'a', sample), env))!.json()
 const listed = await (await handleShares(req('/api/shares?bookId=book-one', 'GET', 'b'), env))!.json()
 expect(listed.shares).toEqual([])
 await handleShares(req(`/api/shares/${id}`, 'DELETE', 'b'), env)
 expect((await handleShares(req(`/s/${id}`, 'GET', ''), env))!.status).toBe(200)
 await handleShares(req(`/api/shares/${id}`, 'DELETE', 'a'), env)
 expect((await handleShares(req(`/s/${id}`, 'GET', ''), env))!.status).toBe(404)
})
it('requires valid login to publish or manage, rejects malformed content without storing it', async () => {
 expect((await handleShares(req('/api/shares', 'POST', '', sample), env))!.status).toBe(401)
 expect((await handleShares(req('/api/shares', 'POST', 'invalid', sample), env))!.status).toBe(401)
 expect((await handleShares(req('/api/shares', 'POST', 'a', { ...sample, doc: { content: 'bad' } }), env))!.status).toBe(400)
 expect(sqlite.prepare('select count(*) as count from shares').get()?.count).toBe(0)
})
it('does not truncate oversized articles into a seemingly complete share', async () => {
 const oversized = { ...sample, subtitle: '大'.repeat(400000) }
 expect((await handleShares(req('/api/shares', 'POST', 'a', oversized), env))!.status).toBe(413)
 expect(sqlite.prepare('select count(*) as count from shares').get()?.count).toBe(0)
})
it('unknown share IDs return 404; non-share routes fall through', async () => {
 expect((await handleShares(req('/s/bad'), env))!.status).toBe(404)
 expect((await handleShares(req('/s/' + '0'.repeat(64)), env))!.status).toBe(404)
 expect(await handleShares(req('/'), env)).toBeNull()
})
