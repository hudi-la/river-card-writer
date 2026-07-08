import { useState } from 'react'
import { useBookStore } from '../state/bookStore'

export function ChapterRail() {
  const chapters = useBookStore((s) => s.book.chapters)
  const activeId = useBookStore((s) => s.activeChapterId)
  const setActive = useBookStore((s) => s.setActiveChapter)
  const addChapter = useBookStore((s) => s.addChapter)
  const renameChapter = useBookStore((s) => s.renameChapter)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(id: string, title: string) {
    setEditingId(id)
    setDraft(title)
  }

  function commit(id: string, fallback: string) {
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
              if (e.key === 'Escape') setEditingId(null)
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
