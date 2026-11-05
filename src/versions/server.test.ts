import { DatabaseSync } from 'node:sqlite'
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { handleVersions } from '../../server/versions'
let sqlite: DatabaseSync
let env: Parameters<typeof handleVersions>[1]
const book = { id: 'article', title: 'Test', boxes: [{ id: 'materials', name: '素材', cards: [] }], translations: { c: ['English'] }, doc: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'c', note: 'private' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文' }] }] }] } }
const request = (path = '', method = 'GET', owner = 'a', body?: unknown) => new Request(`https://river.test/api/versions${path}`, { method, headers: owner ? { Authorization: `Bearer ${owner}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const save = async (kind = 'named', snapshot = book, owner = 'a') => handleVersions(request('', 'POST', owner, { book: snapshot, kind, name: '一稿' }), env)
beforeEach(() => {
 sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync('server/versions.sql', 'utf8'))
 env = { RIVER_SUPABASE_URL: 'https://auth.test', RIVER_SUPABASE_PUBLISHABLE_KEY: 'test', RIVER_SHARES: { prepare(sql) {
  let values: any[] = []
  const statement: any = { bind(...args: any[]) { values = args; return statement }, async first() { return sqlite.prepare(sql).get(...values) ?? null }, async all() { return { results: sqlite.prepare(sql).all(...values) } }, async run() { return sqlite.prepare(sql).run(...values) } }
  return statement
 } } }
 vi.stubGlobal('crypto', webcrypto)
 vi.stubGlobal('fetch', vi.fn(async (_: unknown, options: RequestInit) => {
  const token = (options.headers as Record<string, string>).Authorization
  return ['Bearer a', 'Bearer b'].includes(token) ? Response.json({ id: token.slice(-1) }) : new Response('', { status: 401 })
 }))
})
afterEach(() => { sqlite.close(); vi.unstubAllGlobals() })
it('stores an immutable complete article and privately retrieves it', async () => {
 const response = (await save())!; expect(response.status).toBe(201)
 const created = await response.json()
 const detail = (await handleVersions(request(`/${created.id}`), env))!
 expect(detail.headers.get('Cache-Control')).toBe('no-store')
 expect((await detail.json()).book).toEqual(book)
 await save('named', { ...book, title: 'second' })
 expect((await (await handleVersions(request(`/${created.id}`), env))!.json()).book.title).toBe('Test')
 expect((await (await handleVersions(request('?bookId=article'), env))!.json()).versions).toHaveLength(2)
})
it('never exposes another owner history, even with a known version ID', async () => {
 const { id } = await (await save())!.json()
 expect((await handleVersions(request(`/${id}`, 'GET', ''), env))!.status).toBe(401)
 expect((await handleVersions(request(`/${id}`, 'GET', 'invalid'), env))!.status).toBe(401)
 expect((await handleVersions(request(`/${id}`, 'GET', 'b'), env))!.status).toBe(404)
 expect((await (await handleVersions(request('?bookId=article', 'GET', 'b'), env))!.json()).versions).toEqual([])
 expect(await handleVersions(new Request('https://river.test/other'), env)).toBeNull()
})
it('deduplicates automatic versions despite timestamp changes, but keeps named versions', async () => {
 const first = await (await save('auto'))!.json()
 expect((await (await save('auto', { ...book, updatedAt: 'later' } as any))!.json()).id).toBe(first.id)
 await save('named'); await save('named')
 expect(sqlite.prepare('select count(*) as count from article_versions').get()?.count).toBe(3)
})
it('retains only thirty automatic versions without touching named, safety or other-owner versions', async () => {
 await save('named'); await save('safety'); await save('auto', book, 'b')
 for (let i = 0; i < 35; i++) await save('auto', { ...book, title: `Draft ${i}` })
 expect(sqlite.prepare("select count(*) as count from article_versions where owner='a' and kind='auto'").get()?.count).toBe(30)
 expect(sqlite.prepare("select count(*) as count from article_versions where kind!='auto'").get()?.count).toBe(2)
 expect(sqlite.prepare("select count(*) as count from article_versions where owner='b'").get()?.count).toBe(1)
})
it('rejects malformed and oversized snapshots instead of truncating', async () => {
 expect((await save('named', { ...book, doc: { type: 'doc', content: [] } } as any))!.status).toBe(400)
 expect((await save('unknown'))!.status).toBe(400)
 expect((await save('named', { ...book, title: '大'.repeat(400000) }))!.status).toBe(413)
 expect(sqlite.prepare('select count(*) as count from article_versions').get()?.count).toBe(0)
})
it('a missing database table fails clearly without modifying any article', async () => {
 sqlite.exec('drop table article_versions')
 expect((await save())!.status).toBe(503)
})
