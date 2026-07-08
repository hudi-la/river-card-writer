import { useBookStore } from '../state/bookStore'

export function ChapterRail() {
  const chapters = useBookStore((s) => s.book.chapters)
  const activeId = useBookStore((s) => s.activeChapterId)
  const setActive = useBookStore((s) => s.setActiveChapter)
  const addChapter = useBookStore((s) => s.addChapter)

  return (
    <nav className="rail">
      <p className="rlabel">章</p>
      {chapters.map((c) => (
        <div
          key={c.id}
          className={'chap' + (c.id === activeId ? ' on' : '')}
          onClick={() => setActive(c.id)}
        >
          {c.title}
        </div>
      ))}
      <div className="add" onClick={() => addChapter('新一章')}>＋ 新一章</div>
    </nav>
  )
}
