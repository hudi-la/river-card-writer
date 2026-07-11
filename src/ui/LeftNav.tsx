import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBookStore, UNIVERSAL_BOX_ID, type Box } from '../state/bookStore'
import { usePrefsStore } from '../state/prefsStore'
import { useEditorBridge } from '../state/editorBridge'
import { cardText } from './BoxView'

// 大纲项：从 book.doc 里所有 style==='chapter'（章，level 1）/'h1'（节，level 2）的
// 段落派生出来。index 是该标题在"所有章/节标题"里的序号（不分级别），点击大纲项时
// 拿它去数 DOM 里第几个 [data-style="chapter"|"h1"] 段落，滚过去。
export type OutlineEntry = { level: 1 | 2; text: string; index: number; note: string }

function paragraphText(paragraph: any): string {
  return (paragraph?.content || []).map((n: any) => n?.text || '').join('')
}

const BOX_CARD_PREVIEW_LEN = 30

// 盒子卡片在侧栏里只给一行预览：cardText() 复用 BoxView 的抽取逻辑（多段落用
// \n 拼接），这里再压成单行并截断，空卡（没有任何文字）给个淡色占位而不是空白。
function boxCardPreview(card: any): { text: string; empty: boolean } {
  const raw = cardText(card).replace(/\s+/g, ' ').trim()
  if (!raw) return { text: '（空卡）', empty: true }
  return { text: raw.length > BOX_CARD_PREVIEW_LEN ? raw.slice(0, BOX_CARD_PREVIEW_LEN) + '…' : raw, empty: false }
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

// 大纲树（Phase 12）：把 outlineFromDoc 的"只列标题"换成"每张卡一行"——标题卡
// 是 heading 行，其它卡是 block 行，挂在它前面最近一个标题下面（缩进 = 标题
// 层级 + 1；标题层级最深是 h2=3，块再深一层封顶在 3，不会越界）。cardIndex 是
// doc.content 里的顶层卡序号，setCardNote 按同样的序号定位卡片。
export type OutlineRow = {
  level: 1 | 2 | 3
  kind: 'heading' | 'block'
  text: string
  note: string
  preview: string
  cardIndex: number
}

const BLOCK_PREVIEW_LEN = 14

function headingLevel(style: string): 1 | 2 | 3 {
  return style === 'chapter' ? 1 : style === 'h1' ? 2 : 3
}

export function outlineTreeFromDoc(doc: any): OutlineRow[] {
  const rows: OutlineRow[] = []
  let currentHeadingLevel = 0 // 0 = 还没遇到任何标题
  const cards = doc?.content || []
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const card = cards[cardIndex]
    const paragraphs = card?.content || []
    const headingParagraph = paragraphs.find((p: any) => {
      const style = p?.attrs?.style
      return style === 'chapter' || style === 'h1' || style === 'h2'
    })
    if (headingParagraph) {
      const level = headingLevel(headingParagraph.attrs.style)
      rows.push({
        level,
        kind: 'heading',
        text: paragraphText(headingParagraph),
        note: headingParagraph.attrs?.note || '',
        preview: '',
        cardIndex,
      })
      currentHeadingLevel = level
    } else {
      const text = cardText(card)
      const preview = text ? (text.length > BLOCK_PREVIEW_LEN ? text.slice(0, BLOCK_PREVIEW_LEN) : text) : ''
      rows.push({
        level: Math.min(currentHeadingLevel + 1, 3) as 1 | 2 | 3,
        kind: 'block',
        text,
        note: card?.attrs?.note || '',
        preview,
        cardIndex,
      })
    }
  }
  return rows
}

// RiverEditor（Task 1）把每个段落渲染成 p[data-style=...]，顺序与 doc 里一致——
// 用组合选择器一次查，浏览器按文档顺序返回，第 index 个就是目标标题。三种
// 标题样式都要占位（跟 setHeadingNote/outlineTreeFromDoc 的三级 heading 判定
// 保持一致），querySelectorAll 对逗号选择器始终按文档顺序返回，不受选择器
// 书写顺序影响。
function scrollToOutlineIndex(index: number) {
  const nodes = document.querySelectorAll<HTMLElement>(
    '.river p[data-style="chapter"], .river p[data-style="h1"], .river p[data-style="h2"]',
  )
  nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 块行点击滚动到对应的卡——CardView 把每张卡渲成 section.card，doc.content
// 顶层顺序 = DOM 顺序，cardIndex 直接拿去当下标。
function scrollToCardIndex(cardIndex: number) {
  const nodes = document.querySelectorAll<HTMLElement>('.river section.card')
  nodes[cardIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 大纲树里一行的显示文案：有 note 优先显示 note；否则标题行显示标题文本
// （没有文本给"（无标题）"占位，跟原来一致），块行显示预览（没有预览的空块
// 给淡色"（空块）"占位）。
function outlineRowLabel(row: OutlineRow): { text: string; faint: boolean } {
  if (row.note) return { text: row.note, faint: false }
  if (row.kind === 'heading') return { text: row.text || '（无标题）', faint: false }
  if (row.preview) return { text: row.preview, faint: false }
  return { text: '（空块）', faint: true }
}

function outlineRowClassName(row: OutlineRow): string {
  const kindClass = row.kind === 'heading' ? 'outline-heading' : 'outline-block'
  return `chap outline-row ${kindClass} outline-level-${row.level}`
}

function outlineCardClassName(row: OutlineRow): string {
  const kindClass = row.kind === 'block' ? ' outline-card-block' : ''
  return `outline-card outline-card-level-${row.level}${kindClass}`
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
  const universalBox = useBookStore((s) => s.library.universalBox)
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const openDoc = useBookStore((s) => s.openDoc)
  const openBox = useBookStore((s) => s.openBox)
  const addBox = useBookStore((s) => s.addBox)
  const carry = useBookStore((s) => s.carry)
  const outlineView = usePrefsStore((s) => s.prefs.outlineView)
  const setOutlineView = usePrefsStore((s) => s.setOutlineView)
  const setHeadingNote = useEditorBridge((s) => s.setHeadingNote)
  const setCardNote = useEditorBridge((s) => s.setCardNote)
  const addChapter = useEditorBridge((s) => s.addChapter)

  const rows = outlineTreeFromDoc(book?.doc)
  // 每个 heading 行在"所有 heading 行"里的序号（chapter/h1/h2 都算，跟
  // setHeadingNote 的计数规则一致，见 schema.ts 里的注释）；block 行没有意义，
  // 占位 -1 不会被用到。空文档默认还有一张空的正文卡（EMPTY_DOC），rows 不为
  // 空但一个 heading 都没有——沿用旧版"没有章节标题就显示提示"的判定，不能
  // 简单看 rows.length。
  let headingCounter = -1
  const headingIndices = rows.map((r) => (r.kind === 'heading' ? ++headingCounter : -1))
  const hasHeadings = headingCounter >= 0

  const [hover, setHover] = useState<{ row: OutlineRow; headingIndex: number; left: number; top: number } | null>(
    null,
  )
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 盒子的卡片列表默认展开——集合里存的是"已折叠"的盒子 id，不在集合里 == 展开。
  // 这样新增的盒子（本书新建的/首次渲染的通用盒子）不用额外初始化就是展开态。
  const [collapsedBoxIds, setCollapsedBoxIds] = useState<Set<string>>(new Set())
  const toggleBoxCollapsed = (boxId: string) => {
    setCollapsedBoxIds((prev) => {
      const next = new Set(prev)
      if (next.has(boxId)) next.delete(boxId)
      else next.add(boxId)
      return next
    })
  }

  // 进条目才重算位置（贴着它);进浮层本身只是取消关闭定时器，位置不变——这样
  // 鼠标从条目挪进浮层的路上便签不会跳动。wrapEl 是整行（hover 命中区，留大一点
  // 好触发），但量坐标要用行内那截"文字"元素的 rect（.outline-row-text 是行内
  // span，天然只有文字宽度，不会像整行 div 那样撑满栏宽）——这样便签才会贴在
  // 文字右侧一点点，而不是远在栏的右边缘。
  const openHover = (row: OutlineRow, headingIndex: number, wrapEl: HTMLElement) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    const textEl = wrapEl.querySelector<HTMLElement>('.outline-row-text') ?? wrapEl
    setHover({ row, headingIndex, ...computePopoverPos(textEl.getBoundingClientRect()) })
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

  const handleRowClick = (row: OutlineRow, headingIndex: number) => {
    openDoc()
    // 若刚从盒子视图切回正文，RiverEditor 要等这次 state 更新渲染完才会挂载
    // 对应的 DOM——用 setTimeout(0) 让这次点击先把 React 更新跑完再滚动。
    setTimeout(() => {
      if (row.kind === 'heading') scrollToOutlineIndex(headingIndex)
      else scrollToCardIndex(row.cardIndex)
    }, 0)
  }

  // note 编辑保存的路由：标题行走 setHeadingNote（按 heading 序号），块行走
  // setCardNote（按 doc.content 顶层卡序号）——editorBridge 是唯一改 doc 的路。
  const saveRowNote = (row: OutlineRow, headingIndex: number, value: string) => {
    if (row.kind === 'heading') setHeadingNote(headingIndex, value)
    else setCardNote(row.cardIndex, value)
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
      {!hasHeadings ? (
        <>
          <p className="outline-hint">还没有章节标题</p>
          <div className="add" onClick={() => addChapter()}>
            ＋ 新章节
          </div>
        </>
      ) : (
        <>
          {outlineView === 'detail'
            ? rows.map((row, i) => (
                <div key={row.cardIndex} className={outlineCardClassName(row)}>
                  <div className="outline-card-title" onClick={() => handleRowClick(row, headingIndices[i])}>
                    {row.kind === 'heading' ? row.text || '（无标题）' : row.preview || '（空块）'}
                  </div>
                  <NoteField
                    className="outline-card-note"
                    placeholder="写点说明…"
                    rows={2}
                    initial={row.note}
                    onSave={(value) => saveRowNote(row, headingIndices[i], value)}
                  />
                </div>
              ))
            : rows.map((row, i) => {
                const label = outlineRowLabel(row)
                return (
                  <div
                    key={row.cardIndex}
                    className="outline-item-wrap"
                    onMouseEnter={(e) => openHover(row, headingIndices[i], e.currentTarget)}
                    onMouseLeave={scheduleCloseHover}
                  >
                    <div className={outlineRowClassName(row)} onClick={() => handleRowClick(row, headingIndices[i])}>
                      <span className={'outline-row-text' + (label.faint ? ' faint' : '')}>{label.text}</span>
                    </div>
                  </div>
                )
              })}
          <div className="add" onClick={() => addChapter()}>
            ＋ 新章节
          </div>
        </>
      )}
      {hover &&
        createPortal(
          <div
            key={hover.row.cardIndex}
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
              initial={hover.row.note}
              onSave={(value) => saveRowNote(hover.row, hover.headingIndex, value)}
            />
          </div>,
          document.body,
        )}

      <p className="rlabel nav-group">盒子</p>
      {(book?.boxes ?? []).map((b) => (
        <BoxRow
          key={b.id}
          box={b}
          active={b.id === activeBoxId && viewKind === 'box'}
          collapsed={collapsedBoxIds.has(b.id)}
          onOpen={() => openBox(b.id)}
          onToggleCollapsed={() => toggleBoxCollapsed(b.id)}
          onCarryCard={(cardId) => carry(b.id, cardId)}
        />
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
      {/* 通用盒子不属于本书，跟本书的盒子隔一条浅分隔线，并带一个共享图标——
          提示这是跨所有书共享的同一个盒子，而不是本书的第 N 个盒子。 */}
      <div className="universal-box-divider" />
      <BoxRow
        box={universalBox}
        active={UNIVERSAL_BOX_ID === activeBoxId && viewKind === 'box'}
        collapsed={collapsedBoxIds.has(UNIVERSAL_BOX_ID)}
        onOpen={() => openBox(UNIVERSAL_BOX_ID)}
        onToggleCollapsed={() => toggleBoxCollapsed(UNIVERSAL_BOX_ID)}
        onCarryCard={(cardId) => carry(UNIVERSAL_BOX_ID, cardId)}
        icon="⟡"
        extraClassName="universal-box"
      />
    </nav>
  )
}

// 一个盒子在侧栏里的一行：盒名（点它开该盒子的完整 BoxView）+ 一个折叠箭头
// （单独点它才切换是否展开卡片列表，跟"打开盒子"分开，不会互相打架）+ 展开时
// 缩进列出该盒子的卡片预览。整行（含卡片列表）都在同一个 [data-box-id] 元素
// 内——拖卡到盒子时用 elementFromPoint().closest('[data-box-id]') 找落点
// （见 RiverEditor.tsx），落在卡片预览行上也照样能命中这个盒子。
function BoxRow({
  box,
  active,
  collapsed,
  onOpen,
  onToggleCollapsed,
  onCarryCard,
  icon,
  extraClassName,
}: {
  box: Box
  active: boolean
  collapsed: boolean
  onOpen: () => void
  onToggleCollapsed: () => void
  onCarryCard: (cardId: string) => void
  icon?: string
  extraClassName?: string
}) {
  const cards = box.cards ?? []
  return (
    <div
      data-box-id={box.id}
      className={'chap box-row' + (extraClassName ? ' ' + extraClassName : '') + (active ? ' on' : '')}
    >
      <div className="box-row-header" onClick={onOpen}>
        <span
          className="box-chevron"
          aria-label={collapsed ? '展开' : '折叠'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapsed()
          }}
        >
          {collapsed ? '▸' : '▾'}
        </span>
        {icon && (
          <span className="universal-box-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="box-name">{box.name}</span>
      </div>
      {!collapsed && cards.length > 0 && (
        <div className="box-card-list">
          {cards.map((card, i) => {
            const cardId = card?.attrs?.cardId ?? String(i)
            const preview = boxCardPreview(card)
            return (
              <div key={cardId} className="box-card-item">
                <span className={'box-card-text' + (preview.empty ? ' empty' : '')}>{preview.text}</span>
                <button
                  type="button"
                  className="box-card-carry"
                  title="插入正文"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCarryCard(cardId)
                  }}
                >
                  ⤵
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
