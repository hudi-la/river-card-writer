import { useBookStore } from '../state/bookStore'

// TODO(Phase 7 Task 4): this is a minimal placeholder, not the real left nav.
// The store moved from chapters[] to a single book.doc, so the old
// chapter-list UI (rename, per-chapter active state, etc.) no longer applies —
// Task 4 owns building the real nav (doc entry + box list, rename, drag
// affordances, etc.). This stub exists only so Workspace and the rest of the
// app keep compiling/rendering while Task 4 is in flight.
//
// One thing worth keeping for Task 4: each box row below carries
// `data-box-id` — RiverEditor's ⠿ drag-to-box already queries
// `document` for `[data-box-id]` under the pointer on drop, so as long as
// the real LeftNav keeps that attribute on its box rows, drag-to-box keeps
// working for free.
export function LeftNav() {
  const book = useBookStore((s) => s.book)
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const openDoc = useBookStore((s) => s.openDoc)
  const openBox = useBookStore((s) => s.openBox)
  const addBox = useBookStore((s) => s.addBox)

  return (
    <nav className="rail">
      <p className="rlabel nav-group">正文</p>
      <div className={'chap' + (viewKind === 'doc' ? ' on' : '')} onClick={() => openDoc()}>
        {book.title}
      </div>

      <p className="rlabel nav-group">盒子</p>
      {book.boxes.map((b) => (
        <div
          key={b.id}
          data-box-id={b.id}
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
