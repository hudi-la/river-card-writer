import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.2/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.2/server/webStandardStreamableHttp.js'
import { z } from 'npm:zod@3.25.76'
import { callRiverTool, riverTools, type Repository } from '../_shared/mcp.ts'

Deno.serve(async (req: Request) => {
  const base = `${Deno.env.get('RIVER_PUBLIC_ORIGIN')}/api/river-mcp`
  const issuer = `${Deno.env.get('RIVER_PUBLIC_ORIGIN')}/api/river-auth`
  if (new URL(req.url).pathname.includes('.well-known/oauth-protected-resource') && req.method === 'GET') return Response.json({ resource: base, authorization_servers: [issuer], scopes_supported: ['river:read'], bearer_methods_supported: ['header'] })
  const unauthorized = () => new Response('River authorization required', { status: 401, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` } })
  const secret = req.headers.get('authorization')?.match(/^Bearer (river_[a-f0-9]{64})$/)?.[1]
  if (!secret) return unauthorized()
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))), b => b.toString(16).padStart(2, '0')).join('')
  const { data: token, error } = await db.from('cw_mcp_tokens').select('owner').eq('token_hash', hash).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (error) return new Response('Authentication unavailable', { status: 503 })
  if (!token) return unauthorized()
  const repo: Repository = {
    async list(query, offset) {
      let q = db.from('cw_books').select('id,title,updated_at').eq('owner', token.owner).order('id').range(offset, offset + 50)
      if (query) q = q.ilike('title', `%${query.replace(/[\\%_]/g, '\\$&')}%`)
      const { data, error } = await q
      if (error) throw new Error('暂时无法读取文章列表')
      return (data ?? []).map(b => ({ id: b.id, title: b.title, updatedAt: b.updated_at }))
    },
    async get(id) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) return null
      const { data, error } = await db.from('cw_books').select('id,title,data,updated_at').eq('owner', token.owner).eq('id', id).maybeSingle()
      if (error) throw new Error('暂时无法读取文章')
      return data ? { id: data.id, title: data.title, doc: data.data.doc, subtitle: data.data.subtitle, author: data.data.author, updatedAt: data.updated_at } : null
    },
  }
  const server = new McpServer({ name: 'river', version: '1.0.0' })
  const common = { bookId: z.string(), language: z.enum(['both', 'zh', 'en']).optional(), offset: z.number().int().min(0).optional(), version: z.string().optional() }
  for (const tool of riverTools) {
    const inputSchema: z.ZodRawShape = tool.name === 'search_articles' ? { query: z.string().max(500).optional(), offset: z.number().int().min(0).optional() }
      : tool.name === 'read_chapter' ? { ...common, chapterId: z.string() } : common
    server.registerTool(tool.name, { description: tool.description, inputSchema, annotations: tool.annotations }, async (args: Record<string, unknown>) => {
      try { return { content: [{ type: 'text', text: JSON.stringify(await callRiverTool(repo, tool.name, args)) }] } }
      catch (e) { return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : '读取失败' }] } }
    })
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try { return await transport.handleRequest(req) }
  finally { await server.close() }
})
