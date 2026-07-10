import { useBookStore } from '../state/bookStore'

// 大纲项：从 book.doc 里所有 style==='chapter'（章，level 1）/'h1'（节，level 2）的
// 段落派生出来。index 是该标题在"所有章/节标题"里的序号（不分级别），点击大纲项时
// 拿它去数 DOM 里第几个 [data-style="chapter"|"h1"] 段落，滚过去。
export type OutlineEntry = { level: 1 | 2; text: string; index: number; note: string }

function paragraphText(paragraph: any): string {
  return (paragraph?.content || []).map((n: any) => n?.text || '').join('')
}

// 纯函数，便于单测：不碰 DOM/store，只读 doc 的 JSON 形状（doc.content 是 card
// 数组，每张 card.content 是 paragraph 数组）。
export function outlineFromDoc(doc: any): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  let index = 0
  for (const card of doc?.content || []) {
    for (const paragraph of card?.content || []) {
      const style = paragraph?.attrs?.style
      if (style === 'chapter' || style === 'h1') {
        entries.push({
          level: style === 'chapter' ? 1 : 2,
          text: paragraphText(paragraph),
          index,
          note: paragraph?.attrs?.note || '',
        })
        index++
      }
    }
  }
  return entries
}

// RiverEditor（Task 1）把每个段落渲染成 p[data-style=...]，顺序与 doc 里一致——
// 用组合选择器一次查，浏览器按文档顺序返回，第 index 个就是目标标题。
function scrollToOutlineIndex(index: number) {
  const nodes = document.querySelectorAll<HTMLElement>('.river p[data-style="chapter"], .river p[data-style="h1"]')
  nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function LeftNav() {
  const book = useBookStore((s) => s.activeBook())
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const openDoc = useBookStore((s) => s.openDoc)
  const openBox = useBookStore((s) => s.openBox)
  const addBox = useBookStore((s) => s.addBox)

  const outline = outlineFromDoc(book?.doc)

  const handleOutlineClick = (entry: OutlineEntry) => {
    openDoc()
    // 若刚从盒子视图切回正文，RiverEditor 要等这次 state 更新渲染完才会挂载
    // 对应的 DOM——用 setTimeout(0) 让这次点击先把 React 更新跑完再滚动。
    setTimeout(() => scrollToOutlineIndex(entry.index), 0)
  }

  return (
    <nav className="rail">
      <p className="rlabel nav-group">目录</p>
      {outline.length === 0 ? (
        <p className="outline-hint">还没有章节标题</p>
      ) : (
        outline.map((entry) => (
          <div
            key={entry.index}
            className={'chap outline-item' + (entry.level === 2 ? ' outline-h2' : '')}
            onClick={() => handleOutlineClick(entry)}
          >
            {entry.text || '（无标题）'}
          </div>
        ))
      )}

      <p className="rlabel nav-group">盒子</p>
      {(book?.boxes ?? []).map((b) => (
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
          if (b) openBox(b.id)
        }}
      >
        ＋ 新盒子
      </div>
    </nav>
  )
}
