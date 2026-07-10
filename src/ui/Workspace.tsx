import { useLayoutEffect, useRef } from 'react'
import { useBookStore } from '../state/bookStore'
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

export function Workspace() {
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const activeBookId = useBookStore((s) => s.library.activeBookId)
  const book = useBookStore((s) => s.activeBook())
  const goToShelf = useBookStore((s) => s.goToShelf)
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
        <button className="back-to-shelf" onClick={goToShelf}>
          ← 书柜
        </button>
        <ReadingSettings />
        {viewKind === 'box' ? (
          <BoxView key={activeBoxId} boxId={activeBoxId} />
        ) : (
          <RiverEditor key={activeBookId} />
        )}
      </main>
    </div>
  )
}
