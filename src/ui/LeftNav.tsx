import { useRef, useState } from 'react'
import { useBookStore } from '../state/bookStore'

export function LeftNav() {
  const chapters = useBookStore((s) => s.book.chapters)
  const boxes = useBookStore((s) => s.book.boxes)
  const viewKind = useBookStore((s) => s.viewKind)
  const activeChapterId = useBookStore((s) => s.activeChapterId)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const openChapter = useBookStore((s) => s.openChapter)
  const openBox = useBookStore((s) => s.openBox)
  const addChapter = useBookStore((s) => s.addChapter)
  const addBox = useBookStore((s) => s.addBox)
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
      <p className="rlabel nav-group">章</p>
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
            className={'chap' + (c.id === activeChapterId && viewKind === 'chapter' ? ' on' : '')}
            onClick={() => openChapter(c.id)}
            onDoubleClick={() => startEdit(c.id, c.title)}
          >
            {c.title}
          </div>
        )
      )}
      <div className="add" onClick={() => addChapter('新一章')}>＋ 新一章</div>

      <p className="rlabel nav-group">盒子</p>
      {boxes.map((b) => (
        <div
          key={b.id}
          className={'chap' + (b.id === activeBoxId && viewKind === 'box' ? ' on' : '')}
          onClick={() => openBox(b.id)}
        >
          {b.name}
        </div>
      ))}
      <div
        className="add"
        onClick={() => {
          const b = addBox('新盒子')
          openBox(b.id)
        }}
      >
        ＋ 新盒子
      </div>
    </nav>
  )
}
