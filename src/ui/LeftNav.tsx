import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBookStore } from '../state/bookStore'
import { usePrefsStore } from '../state/prefsStore'
import { useEditorBridge } from '../state/editorBridge'

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

// hover 便签 / 详细视图卡片里的 note 文本框都用这个：本地 state 撑显示，失焦才
// 通过 editorBridge 落到 doc（doc 才是唯一真相源，sidebar 从不直接改它）。
// initial 只在外部 note 真正变化（比如别处改了/切了书）时才拿去重置本地值——
// 打字过程中 initial 不变，不会跟本地输入打架。
function NoteField({
  initial,
  onSave,
  className,
  placeholder,
  rows,
  autoFocus,
}: {
  initial: string
  onSave: (value: string) => void
  className: string
  placeholder: string
  rows?: number
  autoFocus?: boolean
}) {
  const [value, setValue] = useState(initial)
  useEffect(() => setValue(initial), [initial])
  return (
    <textarea
      className={className}
      placeholder={placeholder}
      rows={rows}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onSave(value)}
    />
  )
}

// 鼠标从条目移到浮层的路上会有一瞬间不在任何一个元素上——不留这点缓冲，浮层会
// 秒关，够不到点进去打字。进入条目/浮层任一个都清定时器重开，两个都离开才真关。
const HOVER_CLOSE_DELAY = 200

// .rail 是 position:sticky + overflow-y:auto 的独立滚动容器——按 CSS 规范，设了
// overflow-y 后 overflow-x 也会隐式变成 auto，任何超出栏右边界的绝对定位子元素都会
// 被裁掉。hover 便签就是这样的子元素，之前直接裁没了。改法：便签不再是栏内的绝对
// 定位子元素，而是 portal 到 body 的 fixed 定位元素，坐标从被 hover 条目的
// getBoundingClientRect() 算出来（贴条目右侧），并夹在视口内不出屏——这样栏还能
// 正常独立滚动，便签也不会被栏的裁剪上下文切掉。
const POPOVER_WIDTH = 220
const POPOVER_HEIGHT_ESTIMATE = 170
const POPOVER_GAP = 8
const VIEWPORT_MARGIN = 8

function computePopoverPos(rect: DOMRect) {
  let left = rect.right + POPOVER_GAP
  if (left + POPOVER_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN)
  }
  let top = rect.top
  if (top + POPOVER_HEIGHT_ESTIMATE > window.innerHeight - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, window.innerHeight - POPOVER_HEIGHT_ESTIMATE - VIEWPORT_MARGIN)
  }
  return { left, top }
}

export function LeftNav() {
  const book = useBookStore((s) => s.activeBook())
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const openDoc = useBookStore((s) => s.openDoc)
  const openBox = useBookStore((s) => s.openBox)
  const addBox = useBookStore((s) => s.addBox)
  const outlineView = usePrefsStore((s) => s.prefs.outlineView)
  const setOutlineView = usePrefsStore((s) => s.setOutlineView)
  const setHeadingNote = useEditorBridge((s) => s.setHeadingNote)

  const outline = outlineFromDoc(book?.doc)

  const [hover, setHover] = useState<{ entry: OutlineEntry; left: number; top: number } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 进条目才重算位置（贴着它);进浮层本身只是取消关闭定时器，位置不变——这样
  // 鼠标从条目挪进浮层的路上便签不会跳动。
  const openHover = (entry: OutlineEntry, el: HTMLElement) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHover({ entry, ...computePopoverPos(el.getBoundingClientRect()) })
  }
  const cancelCloseHover = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleCloseHover = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setHover(null), HOVER_CLOSE_DELAY)
  }
  // 栏是独立滚动的——hover 便签的坐标是开 hover 那一刻算的快照,栏一滚条目就挪了位置,
  // 便签会跟丢;不追踪滚动重算,直接关掉最省事,鼠标还悬停在条目上的话下一次
  // mouseenter/mousemove 都不会重开(条目自己没动,鼠标没跟着挪),但滚动本身通常
  // 就意味着用户在找别的条目,关掉是合理的。
  const closeHoverForScroll = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setHover(null)
  }

  const handleOutlineClick = (entry: OutlineEntry) => {
    openDoc()
    // 若刚从盒子视图切回正文，RiverEditor 要等这次 state 更新渲染完才会挂载
    // 对应的 DOM——用 setTimeout(0) 让这次点击先把 React 更新跑完再滚动。
    setTimeout(() => scrollToOutlineIndex(entry.index), 0)
  }

  return (
    <nav className="rail" onScroll={closeHoverForScroll}>
      <p className="rlabel nav-group">目录</p>
      <div className="outline-view-toggle">
        <button type="button" className={outlineView === 'brief' ? 'on' : ''} onClick={() => setOutlineView('brief')}>
          简略
        </button>
        <button type="button" className={outlineView === 'detail' ? 'on' : ''} onClick={() => setOutlineView('detail')}>
          详细
        </button>
      </div>
      {outline.length === 0 ? (
        <p className="outline-hint">还没有章节标题</p>
      ) : outlineView === 'detail' ? (
        outline.map((entry) => (
          <div key={entry.index} className={'outline-card' + (entry.level === 2 ? ' outline-h2' : '')}>
            <div className="outline-card-title" onClick={() => handleOutlineClick(entry)}>
              {entry.text || '（无标题）'}
            </div>
            <NoteField
              className="outline-card-note"
              placeholder="写点说明…"
              rows={2}
              initial={entry.note}
              onSave={(value) => setHeadingNote(entry.index, value)}
            />
          </div>
        ))
      ) : (
        outline.map((entry) => (
          <div
            key={entry.index}
            className="outline-item-wrap"
            onMouseEnter={(e) => openHover(entry, e.currentTarget)}
            onMouseLeave={scheduleCloseHover}
          >
            <div
              className={'chap outline-item' + (entry.level === 2 ? ' outline-h2' : '')}
              onClick={() => handleOutlineClick(entry)}
            >
              {entry.text || '（无标题）'}
            </div>
          </div>
        ))
      )}
      {hover &&
        createPortal(
          <div
            key={hover.entry.index}
            className="note-popover"
            style={{ left: hover.left, top: hover.top }}
            onMouseEnter={cancelCloseHover}
            onMouseLeave={scheduleCloseHover}
          >
            <NoteField
              className="note-popover-textarea"
              placeholder="写点说明…"
              rows={4}
              autoFocus
              initial={hover.entry.note}
              onSave={(value) => setHeadingNote(hover.entry.index, value)}
            />
          </div>,
          document.body,
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
