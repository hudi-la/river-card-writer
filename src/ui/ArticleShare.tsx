import { useState } from 'react'
import { Share2 } from 'lucide-react'
import type { Book } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { supabase } from '../lib/supabase'
import { renderArticle } from '../../supabase/functions/_shared/article'
import { Modal } from './Modal'

type Share = { id: string; title: string; created_at: string }
export function ArticleShare({ book, menu = false }: { book: Book; menu?: boolean }) {
  const [open, setOpen] = useState(false)
  const [shares, setShares] = useState<Share[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const status = useAuthStore(s => s.status)
  const requestSignIn = useAuthStore(s => s.requestSignIn)
  const signedIn = status === 'signed-in'
  const preview = renderArticle(book)
  const link = (id: string) => `${window.location.origin}/s/${id}`
  const api = async (path: string, options: RequestInit = {}) => {
    const session = await supabase?.auth.getSession()
    const token = session?.data.session?.access_token
    if (!token) throw new Error('请先登录 River，再创建分享链接。')
    const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '操作失败，请重试')
    return data
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败，请重试') } finally { setBusy(false) }
  }
  return <>
    <button className={menu ? 'book-menu-item' : 'icon-toggle'} title="分享全文" aria-label="分享全文" onClick={e => {
      e.stopPropagation(); setOpen(true); setShares([]); setMessage('')
      if (signedIn) void run(async () => setShares((await api(`/api/shares?bookId=${encodeURIComponent(book.id)}`)).shares))
    }}><Share2 size={16} aria-hidden="true" />{menu && '分享全文'}</button>
    <Modal title="分享全文" open={open} onClose={() => setOpen(false)}>
      <div className="article-export article-share">
        <p>生成一个可以直接打开的全文链接，发给朋友或 GPT。中英文按“一段中文、一段英文”排列。</p>
        <p><strong>拿到链接的人都能阅读。</strong>只分享当前正文，不含素材盒和备料。后续编辑不会自动更新分享页；你可以撤销旧链接，再分享新版本。</p>
        {preview.warnings.map(w => <p key={w} role="status">{w}</p>)}
        <details><summary>查看将要分享的全文</summary><textarea aria-label="分享全文预览" readOnly value={preview.text} /></details>
        <div className="article-export-actions">
          {signedIn ? <button disabled={busy} onClick={() => void run(async () => {
            const created = await api('/api/shares', { method: 'POST', body: JSON.stringify({ id: book.id, title: book.title, doc: book.doc, subtitle: book.subtitle, author: book.author }) })
            setShares(current => [created, ...current]); setMessage('链接已创建，可以复制分享。')
          })}>{busy ? '处理中…' : '创建分享链接'}</button> : <button onClick={() => { setOpen(false); requestSignIn() }}>登录后创建分享链接</button>}
        </div>
        {shares.map(share => <div className="article-share-link" key={share.id}>
          <p>{new Date(share.created_at).toLocaleString()} 的版本</p>
          <input aria-label="全文分享链接" readOnly value={link(share.id)} onFocus={e => e.target.select()} />
          <div className="article-export-actions">
            <button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(link(share.id)); setMessage('链接已复制') })}>复制链接</button>
            <a href={link(share.id)} target="_blank" rel="noreferrer">打开全文</a>
            <button disabled={busy} onClick={() => void run(async () => {
              await api(`/api/shares/${share.id}`, { method: 'DELETE' }); setShares(current => current.filter(s => s.id !== share.id)); setMessage('链接已撤销，原文仍保留在 River 中。')
            })}>撤销链接</button>
          </div>
        </div>)}
        <p role="status">{message}</p>
      </div>
    </Modal>
  </>
}
