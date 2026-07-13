import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useBookStore, type Book } from '../state/bookStore'
import { usePrefsStore } from '../state/prefsStore'
import { LeftNav } from './LeftNav'
import { RiverEditor } from '../editor/RiverEditor'
import { BoxView } from './BoxView'
import { ReadingSettings } from './ReadingSettings'

const FONT_STACK: Record<'serif' | 'sans', string> = {
  serif: "Georgia,'Songti SC','Noto Serif',serif",
  sans: "system-ui,'PingFang SC','Noto Sans',sans-serif",
}

// 拖拽状态用 useRef 而不是 useState：pointermove 期间不需要触发 Workspace
// 重渲染——setRailWidth 改 prefsStore，prefs 变化本身会重渲染一次去更新 CSS
// var，再叠一份组件 state 只是重复劳动。
type RailDragState = { startX: number; startWidth: number }

// 书内标题：点击/双击进入编辑态（跟书柜封面双击改名同一套手感，只是这里单击
// 也能进——书内没有"点标题会不小心开别的东西"这个顾虑，不需要像 Bookshelf
// 的 BookCard 那样把单击专门让给"开书"）。Enter/失焦提交，空标题（trim 后为
// 空）忽略不保存，退回编辑前的标题。book 切换时（key=book.id 由父组件保证
// 重新挂载）本地 draft 天然跟着重置，不需要额外 effect 同步。
function WorkspaceTitle({ book, renameBook }: { book: Book; renameBook: (id: string, title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(book.title)

  const commitRename = () => {
    const title = draft.trim()
    if (title && title !== book.title) renameBook(book.id, title)
    else setDraft(book.title)
    setEditing(false)
  }

  const beginEdit = () => {
    setDraft(book.title)
    setEditing(true)
  }

  return editing ? (
    <input
      className="workspace-title-edit"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitRename()
        if (e.key === 'Escape') {
          setDraft(book.title)
          setEditing(false)
        }
      }}
    />
  ) : (
    <h1 className="workspace-title" onClick={beginEdit} onDoubleClick={beginEdit}>
      {book.title}
    </h1>
  )
}

export function Workspace() {
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const activeBookId = useBookStore((s) => s.library.activeBookId)
  const book = useBookStore((s) => s.activeBook())
  const goToShelf = useBookStore((s) => s.goToShelf)
  const renameBook = useBookStore((s) => s.renameBook)
  const prefs = usePrefsStore((s) => s.prefs)
  const setRailWidth = usePrefsStore((s) => s.setRailWidth)
  const railDragRef = useRef<RailDragState | null>(null)

  // useLayoutEffect (not useEffect) so persisted prefs are applied to the
  // CSS vars before the browser paints the first frame — otherwise a user
  // with non-default prefs sees one flash of the :root defaults. Same effect
  // also drives --rail-width live while dragging: setRailWidth below updates
  // prefs, which re-runs this effect before paint on every drag step.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--reading-font', FONT_STACK[prefs.font])
    root.style.setProperty('--reading-size', `${prefs.size}px`)
    root.style.setProperty('--reading-measure', `${prefs.measure}px`)
    root.style.setProperty('--rail-width', `${prefs.railWidth}px`)
  }, [prefs])

  // 目录栏拖拽把手：pointer capture 让拖拽过程即使指针移出这条 6px 的细把手也
  // 继续收到 move/up 事件，同时天然阻止拖拽时选中正文文字。宽度在 pointermove
  // 时就通过 setRailWidth 持久化（跟 ReadingSettings 里字号/行宽滑杆同一套
  // 约定：拖动过程本身就是"边拖边存"，pointerup 不用再单独存一次）。
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    railDragRef.current = { startX: e.clientX, startWidth: usePrefsStore.getState().prefs.railWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.classList.add('dragging')
  }
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = railDragRef.current
    if (!drag) return
    setRailWidth(drag.startWidth + (e.clientX - drag.startX))
  }
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!railDragRef.current) return
    railDragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    e.currentTarget.classList.remove('dragging')
  }

  // 异常兜底：shell 已经切到 'book' 但没有 activeBook（比如被删掉了）——安全地
  // 不渲染，而不是读 undefined 崩掉。App 下一次渲染通常会跟着 shell 回书柜。
  if (!book) return null

  return (
    <div className="app">
      <LeftNav />
      <div
        className="rail-resize-handle"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
      />
      <main className="page">
        {/* 顶栏做成 sticky：往下滚正文时这条始终吸在视口顶部，← 书柜 / 书名 / ⚙
            一直够得着（见 .workspace-topbar）。三栏网格 1fr auto 1fr 让书名无论
            两侧按钮多宽都精确居中，且书名保持紧凑——点击区只落在书名本身，不会
            误触整条中缝进改名。 */}
        <div className="workspace-topbar">
          <button className="back-to-shelf" onClick={goToShelf}>
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            书柜
          </button>
          {/* key 加前缀——RiverEditor/BoxView 兄弟节点已经用 activeBookId/activeBoxId
              当 key，book.id 原样用会跟它们撞车（React 会警告"两个子节点同一个
              key"）。这里的 key 只是为了切书时强制重挂载、重置本地 draft/editing
              状态，值本身不需要跟别处的 key 语义一致，加前缀避免撞车即可。 */}
          <WorkspaceTitle key={`title-${book.id}`} book={book} renameBook={renameBook} />
          <ReadingSettings />
        </div>
        {viewKind === 'box' ? (
          <BoxView key={activeBoxId} boxId={activeBoxId} />
        ) : (
          <RiverEditor key={activeBookId} />
        )}
      </main>
    </div>
  )
}
