// Development-only fixture. No requests to production, no real account or manuscript.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useBookStore } from '../src/state/bookStore'
import { startSync, type SyncSupabaseClient } from '../src/state/sync'
import { SaveStatus } from '../src/ui/SaveStatus'
import { Bookshelf } from '../src/ui/Bookshelf'
import { Workspace } from '../src/ui/Workspace'
import '../src/styles.css'
let offline = false
const oldLibrary = structuredClone(useBookStore.getState().library)
const client: SyncSupabaseClient = { from: table => ({
  select: async () => ({ data: JSON.parse(localStorage.getItem('qa:' + table) || '[]'), error: offline ? { message: '模拟离线' } : null }),
  upsert: async rows => {
    if (offline) return { error: { message: '模拟离线' } }
    const next = Array.isArray(rows) ? rows : [rows]
    const previous = JSON.parse(localStorage.getItem('qa:' + table) || '[]')
    for (const row of next) {
      if (table === 'cw_books' && !/^[0-9a-f-]{36}$/i.test(row.id)) return { error: { message: 'invalid uuid' } }
      const i = previous.findIndex((r: any) => (r.id || r.owner) === (row.id || row.owner))
      if (i < 0) previous.push(row); else previous[i] = row
    }
    localStorage.setItem('qa:' + table, JSON.stringify(previous))
    return { error: null }
  },
  delete: () => ({ eq: async () => ({ error: null }) }),
}) }
startSync(useBookStore, client, 'synthetic-owner')
function Fixture() {
  const shell = useBookStore(s => s.shell)
  return <><nav style={{ padding: 12, background: '#e8edf4' }}>
    <strong>仅模拟稿件 · </strong>
    <button onClick={() => { offline = true }}>模拟断网</button>
    <button onClick={() => { offline = false; window.dispatchEvent(new Event('online')) }}>恢复网络</button>
    <button onClick={() => useBookStore.getState().addBook('保存验证稿')}>新增测试稿</button>
    <button onClick={() => { localStorage.setItem('card-writer:library', JSON.stringify(oldLibrary)); location.reload() }}>模拟旧窗口覆盖并重开</button>
  </nav><SaveStatus />{shell === 'book' ? <Workspace /> : <Bookshelf />}</>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
