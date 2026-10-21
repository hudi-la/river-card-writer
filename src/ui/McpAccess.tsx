import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Modal } from './Modal'

export function McpAccess() {
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [keys, setKeys] = useState<{ id: string; created_at: string; expires_at: string }[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const endpoint = `${window.location.origin}/api/river-mcp`
  const refresh = async () => {
    const result = await supabase!.from('cw_mcp_tokens').select('id,created_at,expires_at').is('parent_id', null).order('created_at', { ascending: false })
    if (result.error) throw new Error('连接服务尚未就绪，请稍后重试。')
    setKeys(result.data ?? [])
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  if (!supabase) return null
  return <>
    <button className="book-menu-item" onClick={() => { setOpen(true); void run(refresh) }}>连接 GPT / MCP</button>
    <Modal title="连接 GPT / MCP" open={open} onClose={() => { setOpen(false); setSecret('') }}>
      <div className="article-export">
        <p>只读连接：允许读取你已同步到云端的文章，不允许修改或删除。中英文逐段交错；本地尚未同步的修改不会被读到。</p>
        <label>服务器地址<input style={{ width: '100%' }} readOnly value={endpoint} onFocus={e => e.target.select()} /></label>
        <p>在 ChatGPT 添加自定义 MCP，选择 OAuth。授权页面会要求输入这里生成的连接密钥；密钥有效期 90 天，可随时撤销。</p>
        <button disabled={busy} onClick={() => void run(async () => {
          const value = 'river_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('')
          const { error } = await supabase!.from('cw_mcp_tokens').insert({ token_hash: hash })
          if (error) throw new Error('无法生成密钥，请确认已登录且连接服务已部署。')
          setSecret(value); await refresh()
        })}>生成只读连接密钥</button>
        {secret && <label style={{ display: 'block', marginTop: 12 }}>只显示这一次，请复制保存<input type="password" aria-label="新连接密钥" readOnly value={secret} onFocus={e => e.target.select()} style={{ width: '100%' }} /><button onClick={() => void run(async () => { await navigator.clipboard.writeText(secret); setMessage('密钥已复制') })}>复制密钥</button></label>}
        {keys.map(key => <p key={key.id}>{new Date(key.created_at).toLocaleDateString()} 创建 · {new Date(key.expires_at).toLocaleDateString()} 到期 <button disabled={busy} onClick={() => void run(async () => {
          const { error } = await supabase!.from('cw_mcp_tokens').delete().eq('id', key.id)
          if (error) throw new Error('撤销失败，请重试')
          setSecret(''); await refresh(); setMessage('已撤销该连接及其授权')
        })}>撤销</button></p>)}
        <p role="status">{message}</p>
      </div>
    </Modal>
  </>
}
