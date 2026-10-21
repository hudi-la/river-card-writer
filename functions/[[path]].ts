import { handleShares } from '../server/shares'
// Keep OAuth discovery on the same origin as River. Supabase's default domain
// cannot route root-level RFC 8414 discovery or serve authorization HTML.
export const onRequest = async (context: { request: Request; env: Parameters<typeof handleShares>[1]; next: () => Promise<Response> }) => {
  const shareResponse = await handleShares(context.request, context.env)
  if (shareResponse) return shareResponse
  const url = new URL(context.request.url)
  let route: string | null = null
  if (url.pathname === '/api/river-mcp' || url.pathname.startsWith('/api/river-mcp/')) route = url.pathname.replace('/api/river-mcp', 'river-mcp')
  if (url.pathname.startsWith('/api/river-auth/')) route = url.pathname.replace('/api/river-auth', 'river-auth')
  if (url.pathname === '/.well-known/oauth-authorization-server/api/river-auth') route = 'river-auth/.well-known/oauth-authorization-server'
  if (url.pathname === '/.well-known/oauth-protected-resource/api/river-mcp') route = 'river-mcp/.well-known/oauth-protected-resource'
  if (!route) return context.next()
  if (!context.env.RIVER_SUPABASE_URL) return new Response('River connection is not configured', { status: 503 })
  const target = new URL(`/functions/v1/${route}`, context.env.RIVER_SUPABASE_URL)
  target.search = url.search
  const request = new Request(target, context.request)
  const response = await fetch(request, { redirect: 'manual' })
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (route === 'river-auth/authorize' && request.method === 'GET' && response.status === 200) headers.set('Content-Type', 'text/html;charset=utf-8')
  return new Response(response.body, { status: response.status, headers })
}
