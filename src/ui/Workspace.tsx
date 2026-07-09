import { useBookStore } from '../state/bookStore'
import { LeftNav } from './LeftNav'
import { RiverEditor } from '../editor/RiverEditor'
import { BoxView } from './BoxView'

export function Workspace() {
  const viewKind = useBookStore((s) => s.viewKind)
  const activeChapterId = useBookStore((s) => s.activeChapterId)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  return (
    <div className="app">
      <LeftNav />
      <main className="page">
        {viewKind === 'box' ? (
          <BoxView key={activeBoxId} boxId={activeBoxId} />
        ) : (
          <RiverEditor key={activeChapterId} chapterId={activeChapterId} />
        )}
      </main>
    </div>
  )
}
