import { useLayoutEffect } from 'react'
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

export function Workspace() {
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const activeBookId = useBookStore((s) => s.library.activeBookId)
  const book = useBookStore((s) => s.activeBook())
  const goToShelf = useBookStore((s) => s.goToShelf)
  const prefs = usePrefsStore((s) => s.prefs)

  // useLayoutEffect (not useEffect) so persisted prefs are applied to the
  // CSS vars before the browser paints the first frame — otherwise a user
  // with non-default prefs sees one flash of the :root defaults.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--reading-font', FONT_STACK[prefs.font])
    root.style.setProperty('--reading-size', `${prefs.size}px`)
    root.style.setProperty('--reading-measure', `${prefs.measure}px`)
  }, [prefs])

  // 异常兜底：shell 已经切到 'book' 但没有 activeBook（比如被删掉了）——安全地
  // 不渲染，而不是读 undefined 崩掉。App 下一次渲染通常会跟着 shell 回书柜。
  if (!book) return null

  return (
    <div className="app">
      <LeftNav />
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
