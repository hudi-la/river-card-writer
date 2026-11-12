import { useRef, useState } from 'react'
import { useAuthStore } from '../state/authStore'
import { useBookStore } from '../state/bookStore'
import { versionApi } from '../versions/client'
import { validVersionBook, type VersionDetail } from '../versions/model'
import { Modal } from './Modal'
type Item = { id: string; book_id: string; title: string; created_at: string }
export function recoveryText(doc: any): string {
  if (doc?.type === 'text') return doc.text || ''
  return (doc?.content ?? []).map(recoveryText).join(doc?.type === 'doc' || doc?.type === 'card' ? '\n\n' : '')
}
export function RecoverManuscripts() {
  const owner = useAuthStore(s => s.session?.user.id)
  const [open, setOpen] = useState(false), [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<VersionDetail | null>(null)
  const [next, setNext] = useState<number | null>(null), [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const openedOwner = useRef<string | undefined>(undefined)
  const authorized = (n: number) => generation.current === n && openedOwner.current === owner && useAuthStore.getState().session?.user.id === owner
  async function list(offset = 0) {
    const n = generation.current; setBusy(true); setMessage('')
    try {
      const result = await versionApi(`?recovery=1&offset=${offset}`, {}, owner)
      if (!authorized(n)) return
      setItems(prev => offset ? [...prev, ...result.articles] : result.articles); setNext(result.nextOffset)
      if (!result.articles.length && !offset) setMessage('暂无可恢复的云端历史。')
    } catch (e) { if (authorized(n)) setMessage(e instanceof Error ? e.message : '读取失败') }
    finally { if (authorized(n)) setBusy(false) }
  }
  async function preview(item: Item) {
    const n = generation.current; setBusy(true); setMessage('')
    try {
      const detail = await versionApi(`/${item.id}`, {}, owner)
      if (!authorized(n)) return
      if (!validVersionBook(detail.book) || detail.book.id !== item.book_id) throw new Error('历史版本不完整，未恢复。')
      setSelected(detail)
    } catch (e) { if (authorized(n)) setMessage(e instanceof Error ? e.message : '读取失败') }
    finally { if (authorized(n)) setBusy(false) }
  }
  function restore() {
    if (!selected || openedOwner.current !== owner || useAuthStore.getState().session?.user.id !== owner) return
    const state = useBookStore.getState()
    const book = { ...structuredClone(selected.book), id: crypto.randomUUID(), title: `${selected.book.title} · 历史恢复稿`, updatedAt: new Date().toISOString() }
    state.setLibrary({ ...state.library, books: [...state.library.books, book] })
    setSelected(null); setMessage('已另存到书架，原稿保留。请确认顶部显示已同步到云端。')
  }
  if (!owner) return null
  return <>
    <button className="backup-btn" onClick={() => { generation.current++; openedOwner.current = owner; setOpen(true); setItems([]); setSelected(null); void list() }}>找回稿件</button>
    <Modal open={open && openedOwner.current === owner} title="找回稿件" onClose={() => { generation.current++; setOpen(false) }}>
      <p>查看每篇稿件最近一次有正文的云端历史，包括书架中已找不到的稿件。恢复时另存一份，保留现有内容。</p>
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">正在读取…</p>}
      {selected ? <>
        <h3>{selected.book.title}</h3>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto' }}>{recoveryText(selected.book.doc)}</pre>
        <button onClick={restore} disabled={busy}>另存恢复稿</button>
        <button onClick={() => setSelected(null)}>返回列表</button>
      </> : <>
        <ul>{items.map(item => <li key={item.id} style={{ marginBottom: 12 }}>
          <button disabled={busy} onClick={() => void preview(item)}>{item.title || '未命名'}</button>
          <span> · {new Date(item.created_at).toLocaleString()}</span>
        </li>)}</ul>
        {next !== null && <button disabled={busy} onClick={() => void list(next)}>更多历史稿件</button>}
      </>}
    </Modal>
  </>
}
