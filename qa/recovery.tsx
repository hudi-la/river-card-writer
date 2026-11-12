// Local-only fixture: fake session, history and cloud replacement. No real requests.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useAuthStore } from '../src/state/authStore'
import { supabase } from '../src/lib/supabase'
import { useBookStore } from '../src/state/bookStore'
import { RecoverManuscripts } from '../src/ui/RecoverManuscripts'
import { RiverEditor } from '../src/editor/RiverEditor'
import '../src/styles.css'
const session = { access_token: 'synthetic-token', user: { id: 'synthetic-owner' } } as any
useAuthStore.setState({ session, status: 'signed-in' })
if (supabase) supabase.auth.getSession = async () => ({ data: { session }, error: null })
const book = { id: 'lost-synthetic', title: '恢复验证稿', boxes: [], doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '这是历史中完整保留的模拟正文。' }] }] }] } }
window.fetch = async input => {
 const path = String(input)
 if (!path.startsWith('/api/versions')) throw new Error('Fixture forbids non-history requests')
 return Response.json(path.includes('recovery=1') ? { articles: [{ id: 'version-test', title: book.title, book_id: book.id, created_at: '2026-11-11T08:00:00Z' }], nextOffset: null } : { id: 'version-test', kind: 'auto', name: '自动保存', book, created_at: '2026-11-11T08:00:00Z' })
}
const initial = useBookStore.getState().addBook('编辑器同步验证')
useBookStore.getState().openBook(initial.id)
function Fixture() {
 const books = useBookStore(s => s.library.books)
 return <div style={{ padding: 24 }}><h1>仅模拟数据</h1><RecoverManuscripts />
 <ul>{books.map(b => <li key={b.id}>{b.title}</li>)}</ul>
 <button onClick={() => { const s = useBookStore.getState(); s.setLibrary({ ...s.library, books: s.library.books.map(b => b.id === initial.id ? { ...b, doc: book.doc } : b) }) }}>模拟云端正文到达</button>
 <RiverEditor />
 </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
