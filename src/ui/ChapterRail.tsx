import { useRef, useState } from 'react'
import { useBookStore } from '../state/bookStore'

export function ChapterRail() {
  const chapters = useBookStore((s) => s.book.chapters)
  const activeId = useBookStore((s) => s.activeChapterId)
  const setActive = useBookStore((s) => s.setActiveChapter)
  const addChapter = useBookStore((s) => s.addChapter)
  const renameChapter = useBookStore((s) => s.renameChapter)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // Escape 需要是真取消：setEditingId(null) 之后，被移除的 input 仍可能同步触发一次
  // 原生 blur（React 卸载聚焦元素时的常见行为），从而调用 commit 把刚输入的草稿存回去。
  // 用这个 ref 在 Escape 时打个"跳过下一次 commit"的标记，commit 一进来就检查并短路。
  const skipCommitRef = useRef(false)

  function startEdit(id: string, title: string) {
    setEditingId(id)
    setDraft(title)
  }

  function cancelEdit() {
    skipCommitRef.current = true
    setEditingId(null)
  }

  function commit(id: string, fallback: string) {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    const value = draft.trim() ? draft : fallback
    renameChapter(id, value)
    setEditingId(null)
  }

  return (
    <nav className="rail">
      <p className="rlabel">章</p>
      {chapters.map((c) =>
        editingId === c.id ? (
          <input
            key={c.id}
            className="chap-edit"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(c.id, c.title)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(c.id, c.title)
              if (e.key === 'Escape') cancelEdit()
            }}
          />
        ) : (
          <div
            key={c.id}
            className={'chap' + (c.id === activeId ? ' on' : '')}
            onClick={() => setActive(c.id)}
            onDoubleClick={() => startEdit(c.id, c.title)}
          >
            {c.title}
          </div>
        )
      )}
      <div className="add" onClick={() => addChapter('新一章')}>＋ 新一章</div>
    </nav>
  )
}
