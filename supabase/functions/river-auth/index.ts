import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)))
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
Deno.serve(async req => {
  const base = `${Deno.env.get('RIVER_PUBLIC_ORIGIN')}/api/river-auth`
  const resource = `${Deno.env.get('RIVER_PUBLIC_ORIGIN')}/api/river-mcp`
  const url = new URL(req.url)
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers })
  const fail = (message = 'invalid_request') => json({ error: message }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  try {
    if (url.pathname.includes('.well-known/oauth-authorization-server') && req.method === 'GET') return json({
      issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['river:read'],
    })
    if (url.pathname.endsWith('/register') && req.method === 'POST') {
      const body = await req.json()
      const uris = body.redirect_uris
      if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(u => {
        try { const parsed = new URL(u); return typeof u === 'string' && u.length < 2048 && parsed.protocol === 'https:' && !parsed.hash && !parsed.username && !parsed.password } catch { return false }
      }) || (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none')) return fail()
      const { data, error } = await db.from('cw_mcp_clients').insert({ redirect_uris: uris }).select('id').single()
      if (error) return json({ error: 'server_error' }, 503)
      return json({ client_id: data.id, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }, 201)
    }
    if (url.pathname.endsWith('/authorize') && ['GET', 'POST'].includes(req.method)) {
      const p = req.method === 'GET' ? url.searchParams : new URLSearchParams(await req.text())
      const clientId = p.get('client_id'), redirect = p.get('redirect_uri'), challenge = p.get('code_challenge')
      if (!clientId || !redirect || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || p.get('code_challenge_method') !== 'S256' || p.get('response_type') !== 'code') return fail()
      if (p.get('resource') && p.get('resource') !== resource) return fail('invalid_target')
      if (p.get('scope') && p.get('scope') !== 'river:read') return fail('invalid_scope')
      const { data: client } = await db.from('cw_mcp_clients').select('redirect_uris').eq('id', clientId).maybeSingle()
      if (!client?.redirect_uris.includes(redirect)) return fail('invalid_client')
      if (req.method === 'GET') {
        const fields = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'response_type', 'state', 'resource', 'scope']
        return new Response(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>授权读取 River</title><body><main><h1>授权读取 River</h1><p>此连接将能读取你云端的全部文章，不能修改或删除。</p><p>授权返回地址：${html(new URL(redirect).origin)}</p><p>请在 River 的账户菜单「连接 GPT / MCP」生成只读密钥，然后粘贴到下方。</p><form method="post" action="${html(base)}/authorize">${fields.map(k => `<input type="hidden" name="${k}" value="${html(p.get(k) || '')}">`).join('')}<label>只读连接密钥<input type="password" name="key" required autocomplete="off"></label><button type="submit">允许读取文章</button></form></main></body></html>`, { headers: { ...headers, 'Content-Type': 'text/html;charset=utf-8', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } })
      }
      // POST requires the user's explicit key; no ambient cookie authorization.
      const key = p.get('key') || ''
      if (!/^river_[a-f0-9]{64}$/.test(key)) return fail('invalid_key')
      const { data: parent } = await db.from('cw_mcp_tokens').select('id').eq('token_hash', hex(await digest(key))).is('parent_id', null).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (!parent) return fail('invalid_key')
      const code = random()
      const { error } = await db.from('cw_mcp_codes').insert({ code_hash: hex(await digest(code)), parent_id: parent.id, client_id: clientId, redirect_uri: redirect, challenge })
      if (error) return json({ error: 'server_error' }, 503)
      const target = new URL(redirect); target.searchParams.set('code', code)
      if (p.has('state')) target.searchParams.set('state', p.get('state')!)
      return new Response(null, { status: 303, headers: { ...headers, Location: target.href } })
    }
    if (url.pathname.endsWith('/token') && req.method === 'POST') {
      const p = new URLSearchParams(await req.text())
      if (p.get('grant_type') !== 'authorization_code') return fail('unsupported_grant_type')
      if (p.get('resource') && p.get('resource') !== resource) return fail('invalid_target')
      const verifier = p.get('code_verifier') || ''
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return fail('invalid_grant')
      const challenge = btoa(String.fromCharCode(...await digest(verifier))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      // Atomic consume, with every binding checked in the DELETE itself.
      const { data: code, error } = await db.from('cw_mcp_codes').delete().eq('code_hash', hex(await digest(p.get('code') || ''))).eq('client_id', p.get('client_id')).eq('redirect_uri', p.get('redirect_uri')).eq('challenge', challenge).gt('expires_at', new Date().toISOString()).select('parent_id').maybeSingle()
      if (error || !code) return fail('invalid_grant')
      const { data: parent } = await db.from('cw_mcp_tokens').select('owner,expires_at').eq('id', code.parent_id).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (!parent) return fail('invalid_grant')
      const access = 'river_' + random()
      const { error: insertError } = await db.from('cw_mcp_tokens').insert({ owner: parent.owner, parent_id: code.parent_id, token_hash: hex(await digest(access)), expires_at: parent.expires_at })
      if (insertError) return json({ error: 'server_error' }, 503)
      return json({ access_token: access, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((Date.parse(parent.expires_at) - Date.now()) / 1000)), scope: 'river:read' })
    }
    return new Response('Not found', { status: 404, headers })
  } catch { return fail() }
})
