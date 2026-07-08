import { useBookStore } from '../state/bookStore'
import { ChapterRail } from './ChapterRail'
import { RiverEditor } from '../editor/RiverEditor'

export function Workspace() {
  const activeId = useBookStore((s) => s.activeChapterId)
  return (
    <div className="app">
      <ChapterRail />
      <main className="page">
        <RiverEditor key={activeId} chapterId={activeId} />
      </main>
    </div>
  )
}
