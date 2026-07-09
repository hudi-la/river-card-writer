import { useBookStore } from '../state/bookStore'
import { LeftNav } from './LeftNav'
import { RiverEditor } from '../editor/RiverEditor'

// 占位实现：Task 3 会替换成真正的 BoxView。
function BoxViewPlaceholder({ boxId }: { boxId: string | null }) {
  const box = useBookStore((s) => s.getBox(boxId))
  return <div>盒子：{box?.name ?? ''}</div>
}

export function Workspace() {
  const viewKind = useBookStore((s) => s.viewKind)
  const activeChapterId = useBookStore((s) => s.activeChapterId)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  return (
    <div className="app">
      <LeftNav />
      <main className="page">
        {viewKind === 'box' ? (
          <BoxViewPlaceholder key={activeBoxId} boxId={activeBoxId} />
        ) : (
          <RiverEditor key={activeChapterId} chapterId={activeChapterId} />
        )}
      </main>
    </div>
  )
}
