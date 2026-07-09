import { useEffect } from 'react'
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
  const activeChapterId = useBookStore((s) => s.activeChapterId)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const prefs = usePrefsStore((s) => s.prefs)

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--reading-font', FONT_STACK[prefs.font])
    root.style.setProperty('--reading-size', `${prefs.size}px`)
    root.style.setProperty('--reading-measure', `${prefs.measure}px`)
  }, [prefs])

  return (
    <div className="app">
      <LeftNav />
      <main className="page">
        <ReadingSettings />
        {viewKind === 'box' ? (
          <BoxView key={activeBoxId} boxId={activeBoxId} />
        ) : (
          <RiverEditor key={activeChapterId} chapterId={activeChapterId} />
        )}
      </main>
    </div>
  )
}
