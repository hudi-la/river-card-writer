// Integration tests exercise the real HTTP transports against a fake PostgREST
// service. No production credentials or user articles are used.
const assert = (ok: unknown, message = 'assertion failed') => { if (!ok) throw new Error(message) }
const originalFetch = globalThis.fetch
const originalServe = Deno.serve
const tables: Record<string, any[]> = { cw_mcp_clients: [], cw_mcp_codes: [], cw_mcp_tokens: [], cw_books: [] }
let ownerFilters: string[] = []
Deno.env.set('SUPABASE_URL', 'https://river-test.supabase.co')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role')
Deno.env.set('RIVER_PUBLIC_ORIGIN', 'https://river.test')
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
 const request = new Request(input, init), url = new URL(request.url)
 if (url.hostname !== 'river-test.supabase.co') throw new Error('Unexpected network request')
 const table = url.pathname.split('/').pop()!
 const rows = tables[table]
 if (!rows) throw new Error(`Unknown table ${table}`)
 if (table === 'cw_books') ownerFilters.push(url.searchParams.get('owner') || '')
 const matches = (row: any) => [...url.searchParams].every(([key, value]) => {
  if (['select', 'order', 'offset', 'limit'].includes(key)) return true
  const dot = value.indexOf('.'), op = value.slice(0, dot), operand = value.slice(dot + 1)
  if (op === 'eq') return String(row[key]) === operand
  if (op === 'gt') return row[key] > operand
  if (op === 'is') return operand === 'null' && row[key] == null
  return true
 })
 let result: any[]
 if (request.method === 'POST') {
  const row = { id: crypto.randomUUID(), parent_id: null, expires_at: new Date(Date.now() + 3600000).toISOString(), ...await request.json() }
  rows.push(row); result = [row]
 } else {
  result = rows.filter(matches)
  if (request.method === 'DELETE') tables[table] = rows.filter(row => !matches(row))
 }
 const single = request.headers.get('accept')?.includes('vnd.pgrst.object')
 return Response.json(single ? result[0] ?? null : result)
}) as typeof fetch
let captured: (req: Request) => Promise<Response>
Deno.serve = ((handler: any) => { captured = handler; return {} }) as typeof Deno.serve
await import('../functions/river-auth/index.ts')
const auth = captured!
await import('../functions/river-mcp/index.ts')
const mcp = captured!
Deno.serve = originalServe
const hash = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('')
const post = (path: string, fields: Record<string, string>) => new Request(`https://river.test/api/river-auth/${path}`, { method: 'POST', body: new URLSearchParams(fields) })
Deno.test('OAuth binds redirect + PKCE, codes are one-use, MCP only reads authorized owner', async () => {
 try {
  const key = 'river_' + 'a'.repeat(64)
  tables.cw_mcp_tokens.push({ id: 'parent', token_hash: await hash(key), owner: 'owner-a', parent_id: null, expires_at: new Date(Date.now() + 3600000).toISOString() })
  const uri = 'https://client.test/callback'
  const registration = await auth(new Request('https://river.test/api/river-auth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [uri], token_endpoint_auth_method: 'none' }) }))
  assert(registration.status === 201)
  const client = await registration.json()
  const verifier = 'v'.repeat(43)
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const fields = { client_id: client.client_id, redirect_uri: uri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'state', key }
  assert((await auth(post('authorize', { ...fields, redirect_uri: 'https://evil.test' }))).status === 400)
  const consent = await auth(new Request('https://river.test/api/river-auth/authorize?' + new URLSearchParams(fields)))
  assert((await consent.text()).includes('允许读取文章'))
  const authorized = await auth(post('authorize', fields))
  assert(authorized.status === 303)
  const location = new URL(authorized.headers.get('Location')!)
  assert(location.searchParams.get('state') === 'state')
  const exchange = { client_id: client.client_id, redirect_uri: uri, grant_type: 'authorization_code', code: location.searchParams.get('code')!, code_verifier: verifier }
  assert((await auth(post('token', { ...exchange, code_verifier: 'x'.repeat(43) }))).status === 400)
  const tokenResponse = await auth(post('token', exchange))
  assert(tokenResponse.status === 200)
  const token = (await tokenResponse.json()).access_token
  assert((await auth(post('token', exchange))).status === 400, 'code replay must fail')
  const rpc = async (method: string, params: unknown = {}, bearer = token) => mcp(new Request('https://river.test/api/river-mcp', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert(init.status === 200, 'SDK initialization works')
  assert((await init.json()).result.serverInfo.name === 'river')
  const tools = await rpc('tools/list'); assert((await tools.json()).result.tools.length === 3)
  tables.cw_books.push({ id: '11111111-1111-1111-1111-111111111111', title: 'Mine', owner: 'owner-a', data: { doc: { content: [] } } }, { id: '22222222-2222-2222-2222-222222222222', title: 'Other private', owner: 'owner-b', data: { doc: { content: [] } } })
  const search = await rpc('tools/call', { name: 'search_articles', arguments: {} })
  const searchBody = JSON.stringify(await search.json())
  assert(searchBody.includes('Mine') && !searchBody.includes('Other private'))
  const read = await rpc('tools/call', { name: 'read_article', arguments: { bookId: '22222222-2222-2222-2222-222222222222' } })
  assert((await read.json()).result.isError)
  assert(ownerFilters.length === 2 && ownerFilters.every(f => f === 'eq.owner-a'))
  assert((await rpc('tools/list', {}, 'invalid')).status === 401)
  tables.cw_mcp_tokens = []
  assert((await rpc('tools/list')).status === 401, 'revoked token must fail')
 } finally { globalThis.fetch = originalFetch }
})
