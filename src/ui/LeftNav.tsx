import { NOTE_EDITING_ENABLED } from '../noteEditing'
import { useRef, useState, useEffect, type CSSProperties, type RefObject, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Plus, GripVertical, ChevronDown, ChevronRight, Package } from 'lucide-react'
import { useBookStore, type Box } from '../state/bookStore'
import { useEditorBridge } from '../state/editorBridge'
import { cardText, UniversalBoxModal } from './BoxView'
import { autoCardColor } from '../editor/schema'
import { countCardWords } from '../editor/wordCount'
import { DROP_TARGET_CLASS } from '../editor/RiverEditor'
import { Modal } from './Modal'
import { OutlineDetail } from './OutlineDetail'

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
  // 标题的折叠态（Phase 13 Task 2）——只对 kind==='heading' 有意义，读自该标题
  // 段落的 collapsed 属性（跟 schema.ts 的 toggleCollapsed/hiddenCardIndices 是
  // 同一个属性）。block 行恒为 false，不参与折叠。
  collapsed: boolean
  // 该行对应卡片的底色（Phase 14 Task 1 #2）——跟正文 CardView 同一套规则：手动
  // 设了 color 就用它，否则按 cardId 走 autoCardColor 稳定哈希出默认色。目录和
  // 正文因此永远读的是同一份颜色，不会各算各的。
  bg: string
  // 是否手动设色——决定色带透明度档位，跟正文 .river .card[data-color]（16%）
  // vs 没设色时的默认（13%）两档保持一致。
  bgExplicit: boolean
  // 这张卡自己的字数（标题卡含标题文字）。标题行在目录里显示的是整段累计，
  // 由 outlineRowWords 按 outlineSectionRange 现加，这里只存单卡的数。
  words: number
}

function headingLevel(style: string): 1 | 2 | 3 {
  return style === 'chapter' ? 1 : style === 'h1' ? 2 : 3
}

// 读一张卡的底色 + 是否手动设色——heading 行、block 行共用同一份逻辑，都是
// 直接读它所在的卡（doc.content[cardIndex]），跟 CardView.tsx 里 `bg = color ||
// autoCardColor(cardId)` 完全同一条公式，保证目录色带 = 正文色带。
function cardBg(card: any): { bg: string; explicit: boolean } {
  const cardId: string = card?.attrs?.cardId || ''
  const explicitColor: string | null = card?.attrs?.color || null
  return { bg: explicitColor || autoCardColor(cardId), explicit: !!explicitColor }
}

export function outlineTreeFromDoc(doc: any): OutlineRow[] {
  const rows: OutlineRow[] = []
  let currentHeadingLevel = 0 // 0 = 还没遇到任何标题
  const cards = doc?.content || []
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const card = cards[cardIndex]
    const { bg, explicit: bgExplicit } = cardBg(card)
    const words = countCardWords(card)
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
        collapsed: !!headingParagraph.attrs?.collapsed,
        bg,
        bgExplicit,
        words,
      })
      currentHeadingLevel = level
    } else {
      const text = cardText(card)
      // 预览不再在 JS 里固定截到 N 字（Phase 14 Task 1 #4）——完整文字进 DOM，
      // 交给渲染时的单行省略容器（.outline-preview-ellipsis）按实际行宽截断，
      // 宽一点的栏能显示更多字，窄栏自动少显示，都以「…」收尾。
      rows.push({
        level: Math.min(currentHeadingLevel + 1, 3) as 1 | 2 | 3,
        kind: 'block',
        text,
        note: card?.attrs?.note || '',
        preview: text,
        cardIndex,
        collapsed: false,
        bg,
        bgExplicit,
        words,
      })
    }
  }
  return rows
}

// RiverEditor（Task 1）把每个段落渲染成 p[data-style=...]，顺序与 doc 里一致——
// 用组合选择器一次查，浏览器按文档顺序返回，第 index 个就是目标标题。三种
// 标题样式都要占位（跟 setHeadingNote/outlineTreeFromDoc 的三级 heading 判定
// 保持一致），querySelectorAll 对逗号选择器始终按文档顺序返回，不受选择器
// 书写顺序影响。导出给 OutlineDetail（Phase 14 Task 2）复用——大窗里的详细
// 视图点行滚动跟侧栏简略视图是同一份滚动逻辑，不能各写一份容易漂移。
export function scrollToOutlineIndex(index: number) {
  const nodes = document.querySelectorAll<HTMLElement>(
    '.river p[data-style="chapter"], .river p[data-style="h1"], .river p[data-style="h2"]',
  )
  nodes[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 块行点击滚动到对应的卡——CardView 把每张卡渲成 section.card，doc.content
// 顶层顺序 = DOM 顺序，cardIndex 直接拿去当下标。同上，导出给 OutlineDetail 复用。
export function scrollToCardIndex(cardIndex: number) {
  const nodes = document.querySelectorAll<HTMLElement>('.river section.card')
  nodes[cardIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 大纲树里一行的显示文案：有 note 优先显示 note；否则标题行显示标题文本
// （没有文本给"（无标题）"占位，跟原来一致），块行显示预览（没有预览的空块
// 给淡色"（空块）"占位）。
export function outlineRowLabel(row: OutlineRow): { text: string; faint: boolean } {
  if (row.note) return { text: row.note, faint: false }
  if (row.kind === 'heading') return { text: row.text || '（无标题）', faint: false }
  if (row.preview) return { text: row.preview, faint: false }
  return { text: '（空块）', faint: true }
}

// 折叠记号（Phase 14 Task 1 #1）：只加在收起的标题行上——展开的标题行、所有
// 块行都不带这个 class。视觉记号本身（淡"…"）走 CSS ::after，挂在这个 class
// 的后代选择器上，见 styles.css。
const OUTLINE_COLLAPSED_CLASS = 'outline-collapsed'
// 手动设色的行（Phase 14 Task 1 #2）：色带透明度要跟正文 .river .card[data-color]
// 对齐到更深的一档（16% vs 默认 13%），靠这个 class 切换 color-mix 的百分比。
const OUTLINE_COLOR_EXPLICIT_CLASS = 'outline-color-explicit'

function outlineRowClassName(row: OutlineRow): string {
  const kindClass = row.kind === 'heading' ? 'outline-heading' : 'outline-block'
  const collapsedClass = row.kind === 'heading' && row.collapsed ? ` ${OUTLINE_COLLAPSED_CLASS}` : ''
  const colorClass = row.bgExplicit ? ` ${OUTLINE_COLOR_EXPLICIT_CLASS}` : ''
  return `chap outline-row ${kindClass} outline-level-${row.level}${collapsedClass}${colorClass}`
}

export function outlineCardClassName(row: OutlineRow): string {
  const kindClass = row.kind === 'block' ? ' outline-card-block' : ''
  const collapsedClass = row.kind === 'heading' && row.collapsed ? ` ${OUTLINE_COLLAPSED_CLASS}` : ''
  const colorClass = row.bgExplicit ? ` ${OUTLINE_COLOR_EXPLICIT_CLASS}` : ''
  return `outline-card outline-card-level-${row.level}${kindClass}${collapsedClass}${colorClass}`
}

// 这一行的底色变量——统一走 CSS 自定义属性 --row-bg，styles.css 用同一条
// color-mix 公式（跟正文 .river .card 一致）算出实际背景色。
export function outlineRowStyle(row: OutlineRow): CSSProperties {
  return { ['--row-bg' as any]: row.bg }
}

// 块行的预览/说明容器要单行省略截断（Phase 14 Task 1 #4），标题行不变——用一个
// 独立 class 而不是复用已有的 .outline-row-text，方便单独断言、单独调整样式。
function outlineRowTextClassName(row: OutlineRow, faint: boolean): string {
  let cls = 'outline-row-text'
  if (faint) cls += ' faint'
  if (row.kind === 'block') cls += ' outline-preview-ellipsis'
  // 显示的是「章节题目(heading)」或「卡片开头(preview)」→ 用黑字；显示的是「说明(note)」→ 保持淡色。
  // 判定跟 outlineRowLabel 的取值优先级一致：有 note 就在显示 note（→浅），否则 heading 显示标题、
  // block 显示预览（→黑）。删掉说明后 row.note 变空，自然回落到显示预览、跟着变黑。
  if (!row.note && (row.kind === 'heading' || row.preview)) cls += ' outline-row-strong'
  return cls
}

// 详细视图卡片标题：跟简略视图同样的省略规则 + 折叠记号挂载点。
export function outlineCardTitleTextClassName(row: OutlineRow): string {
  let cls = 'outline-card-title-text'
  if (row.kind === 'block') cls += ' outline-preview-ellipsis'
  return cls
}

// hover 便签 / 详细视图卡片里的 note 文本框都用这个：本地 state 撑显示，失焦才
// 通过 editorBridge 落到 doc（doc 才是唯一真相源，sidebar 从不直接改它）。
// initial 只在外部 note 真正变化（比如别处改了/切了书）时才拿去重置本地值——
// 打字过程中 initial 不变，不会跟本地输入打架。
export function NoteField({
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

// ---- 目录内拖动重排（Phase 12 Task 3）----
// 跟 RiverEditor 里 ⠿ 拖卡片同一套命令式骨架（阈值判定点击/拖拽、固定定位的
// ghost + 落点线、多事件收尾幂等），换成对着大纲行操作：抓一行上下拖，松手把
// 对应的卡（块行）或整段（标题行，连它管辖的正文块/子节一起）挪到新位置。

const OUTLINE_DRAG_MOVE_THRESHOLD_PX = 4
const OUTLINE_DRAG_ACTIVE_CLASS = 'outline-drag-active'

type OutlineDragState = {
  startIndex: number // 被抓那一行的 cardIndex——rows 数组下标本身就是 cardIndex（见下方 rowsRef 注释）
  kind: 'heading' | 'block'
  headingIndex: number // 只在 kind==='heading' 时有意义，供未越阈值时的定位滚动用
  sectionStart: number
  sectionEnd: number // 不含
  sourceEls: HTMLElement[]
  ghostEl: HTMLElement
  indicatorEl: HTMLElement
  startX: number
  startY: number
  moved: boolean
  pointerId: number
  pendingTargetIndex: number | null
  // 悬停在哪个盒子条目上——跟 RiverEditor.tsx 的 DragState 同名字段同一个用途
  // （见那边的注释）：只有 kind==='block' 的行才会把这两个字段设成非 null（拖一整段
  // 到盒子明确不支持，见 useOutlineRowDrag 里 onPointerMove 的判断）。
  targetBoxId: string | null
  targetBoxEl: HTMLElement | null
}

// 复刻 LeftNav 渲染时 headingIndices 数组的算法（该标题在"所有 heading 行"里
// 的序号，chapter/h1/h2 都算，index 本身也可能是块行——块行不参与计数，返回值
// 无意义）。拖拽 effect 里没法直接读渲染时闭包住的 headingIndices（会跟没用
// rowsRef 兜底的普通变量一样有 stale 风险），干脆拿当下最新的 rows 重新数一遍，
// 保证跟 scrollToOutlineIndex/handleRowClick 用的下标定义一致。
export function headingIndexAt(rows: OutlineRow[], index: number): number {
  let counter = -1
  for (let i = 0; i <= index; i++) {
    if (rows[i].kind === 'heading') counter++
  }
  return counter
}

// 标题行拖的是"整段"：自己 + 后面直到下一个 level ≤ 自己的标题行之前的所有行
// （含中间夹着的更深层子节/正文块）。跟 schema.ts 里 moveSection 命令的范围
// 判定逻辑完全对应——outlineTreeFromDoc 本来就是一张卡一行，rows[i].cardIndex
// 恒等于 i，rows 数组顺序 = doc.content 顺序。
export function outlineSectionRange(rows: OutlineRow[], index: number): [number, number] {
  const row = rows[index]
  if (row.kind !== 'heading') return [index, index + 1]
  let end = rows.length
  for (let i = index + 1; i < rows.length; i++) {
    if (rows[i].kind === 'heading' && rows[i].level <= row.level) {
      end = i
      break
    }
  }
  return [index, end]
}

// 目录里一行显示的字数：块行就是自己那张卡；标题行是整段累计——范围跟拖动
// 重排、折叠用的是同一份 outlineSectionRange，折叠与否不影响数字。
export function outlineRowWords(rows: OutlineRow[], index: number): number {
  const [start, end] = outlineSectionRange(rows, index)
  let total = 0
  for (let i = start; i < end; i++) total += rows[i].words
  return total
}

// 折叠三角（Phase 13 Task 2）：一个标题行"有没有后代"决定三角是否可点——复用
// outlineSectionRange（跟拖动重排同一份"整段"边界定义），[index+1, end) 非空
// 就是有后代（块和/或子标题）。
export function outlineRowHasDescendants(rows: OutlineRow[], index: number): boolean {
  if (rows[index].kind !== 'heading') return false
  const [, end] = outlineSectionRange(rows, index)
  return end > index + 1
}

// 渲染前把 rows 过滤成"可见行"：collapsed 的标题行跳过它管辖的整段后代（块 +
// 子标题，含嵌套——外层折叠时子节自然落在同一个 sectionRange 里，不用特殊处理
// 嵌套）。保留每行在完整 rows 数组里的原始下标（=cardIndex），拖拽/note/滚动
// 逻辑都靠这个下标定位，过滤不能打乱它。
export function visibleOutlineRows(rows: OutlineRow[]): { row: OutlineRow; index: number }[] {
  const visible: { row: OutlineRow; index: number }[] = []
  let skipUntil = 0
  for (let i = 0; i < rows.length; i++) {
    if (i < skipUntil) continue
    const row = rows[i]
    visible.push({ row, index: i })
    if (row.kind === 'heading' && row.collapsed) {
      const [, end] = outlineSectionRange(rows, i)
      if (end > skipUntil) skipUntil = end
    }
  }
  return visible
}

// 折叠三角本体：没有后代时渲染一个不可点的占位（保持文字对齐），有后代时渲染
// 真三角——▾ 展开 / ▸ 折叠，点击必须 stopPropagation+preventDefault，不然会
// 冒泡触发行的 onClick（click-to-scroll）；它是个 <button>，天然落在目录拖拽
// pointerdown 处理器的 `target.closest('textarea, button, ...')` 排除名单里，
// 不会被当成拖拽起点。
// 拖拽把手（Phase 15 回归修复）：⠿ 抓手，每行右侧、hover 才淡淡露出。见下面
// useOutlineRowDrag 的 onPointerDown 注释——拖拽现在只认这个把手当起点，不再
// 跟整行的点击/双击/折叠三角抢同一个手势入口。侧栏简略树、详细大纲（OutlineDetail）
// 都渲染它、都共用同一个 class/data 属性，拖拽 hook 认的是 data 属性,不关心
// 渲染在哪个视图里。
export const OUTLINE_DRAG_HANDLE_SELECTOR = '[data-outline-drag-handle]'

// 目录行尾的字数（千分位）。0 不显示——空卡、空章不留一排 0 的噪音。侧栏简略
// 树、详细大纲共用；数字本身由调用方用 outlineRowWords 算好传进来。
export function OutlineWordCount({ words }: { words: number }) {
  if (words <= 0) return null
  const text = words.toLocaleString('en-US')
  return (
    <span className="outline-words" title={`${text} 字`}>
      {text}
    </span>
  )
}

export function OutlineDragHandle({ rows, index }: { rows: OutlineRow[]; index: number }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const moveSection = useEditorBridge((s) => s.moveSection)
  const moveCardTo = useEditorBridge((s) => s.moveCardTo)
  const row = rows[index]
  const label = outlineRowLabel(row).text
  const close = () => { setPos(null); button.current?.focus() }
  useEffect(() => {
    if (!pos) return
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setPos(null)
    }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    const scroll = () => setPos(null)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', scroll)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', scroll)
    }
  }, [pos])
  return <>
    <button type="button" ref={button} className="outline-drag-handle" data-outline-drag-handle
      aria-label={`移动：${label}`} aria-expanded={!!pos} aria-haspopup="dialog" title="拖动排序，或点击选择位置"
      onClick={(e) => {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        setPos(pos ? null : { left: Math.max(8, Math.min(rect.right - 280, window.innerWidth - 288)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 100)) })
      }}>
      <GripVertical size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
    {pos && createPortal(<div ref={menu} className="outline-move-popover" role="dialog" aria-label={`移动：${label}`} style={pos} onClick={(e) => e.stopPropagation()}>
      <label>移动到
        <select autoFocus aria-label={`移动位置：${label}`} defaultValue="" onChange={(e) => {
          if (e.target.value === '') return
          const target = Number(e.target.value)
          close()
          if (row.kind === 'heading') moveSection(row.cardIndex, target)
          else moveCardTo(row.cardIndex, target)
        }}>
          <option value="">选择位置（标题连同内容移动）</option>
          {rows.map((target, n) => <option key={n} value={n} disabled={n >= index && n <= outlineSectionRange(rows, index)[1]}>第 {n + 1} 项前：{outlineRowLabel(target).text.slice(0, 25)}</option>)}
          <option value={rows.length} disabled={outlineSectionRange(rows, index)[1] === rows.length}>移到末尾</option>
        </select>
      </label>
    </div>, document.body)}
  </>
}

export function OutlineCollapseTriangle({
  row,
  hasDescendants,
  onToggle,
}: {
  row: OutlineRow
  hasDescendants: boolean
  onToggle: () => void
}) {
  if (!hasDescendants) return <span className="outline-collapse-triangle outline-collapse-triangle-empty" aria-hidden="true" />
  return (
    <button
      type="button"
      className="outline-collapse-triangle"
      aria-label={row.collapsed ? '展开' : '折叠'}
      aria-expanded={!row.collapsed}
      data-collapsed={row.collapsed}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onToggle()
      }}
    >
      {row.collapsed ? (
        <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  )
}

// 排除掉被拖这一段的所有行元素，按文档顺序返回——跟 RiverEditor 的 otherCards
// 是同一个套路。
function otherOutlineRowEls(railEl: HTMLElement, sectionStart: number, sectionEnd: number): HTMLElement[] {
  return Array.from(railEl.querySelectorAll<HTMLElement>('[data-outline-row-index]')).filter((el) => {
    const i = Number(el.dataset.outlineRowIndex)
    return i < sectionStart || i >= sectionEnd
  })
}

// 算出落点：目标下标是"插到原 doc 里当前排在这里的那一行之前"（跟 moveSection/
// editorBridge.moveCardTo 统一的绝对下标语义，见 editorBridge.ts 的注释），落点线
// 的像素位置一起算出来，一次遍历两件事都拿到，不重复扫。
function outlineDropAt(
  els: HTMLElement[],
  clientY: number,
  totalRows: number,
): { targetIndex: number; rect: { top: number; left: number; width: number } | null } {
  if (els.length === 0) return { targetIndex: totalRows, rect: null }
  let pos = els.length
  for (let i = 0; i < els.length; i++) {
    const rect = els[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) {
      pos = i
      break
    }
  }
  const targetIndex = pos >= els.length ? totalRows : Number(els[pos].dataset.outlineRowIndex)
  let rect: { top: number; left: number; width: number }
  if (pos <= 0) {
    const r = els[0].getBoundingClientRect()
    rect = { top: r.top, left: r.left, width: r.width }
  } else if (pos >= els.length) {
    const r = els[els.length - 1].getBoundingClientRect()
    rect = { top: r.bottom, left: r.left, width: r.width }
  } else {
    const prev = els[pos - 1].getBoundingClientRect()
    const next = els[pos].getBoundingClientRect()
    rect = { top: (prev.bottom + next.top) / 2, left: next.left, width: next.width }
  }
  return { targetIndex, rect }
}

// 目录行的拖动重排：跟 RiverEditor 里 ⠿ 拖卡片同一套命令式骨架，落点算在
// "目录里另一行之间"而不是正文卡片之间；松手时块行走 editorBridge.moveCardTo，
// 标题行走 editorBridge.moveSection（带走它整段）。
//
// 抽成 hook（Phase 14 Task 2）：侧栏简略树、大窗里的 OutlineDetail 都要支持
// 同一套拖拽重排，逻辑本身跟"渲染成什么样子"无关，只认 DOM 上的
// [data-outline-row-index] 属性——container 换成哪个 DOM 子树（.rail 还是
// modal 里的 .outline-detail）都一样工作，参数只需要拿到最新 rows（用 ref
// 避免闭包过期）、容器 ref、以及三个落地要调的回调。onDragBegin 是可选的
// （命名跟原生 dragstart 事件监听器区分开，避免同名变量互相遮蔽）——
// 侧栏简略视图用它来关掉 hover 便签，详细视图没有 hover 便签，不传即可。
export function useOutlineRowDrag({
  containerRef,
  rowsRef,
  moveSection,
  moveCardTo,
  openDoc,
  onDragBegin,
  parkCardToBox,
}: {
  containerRef: RefObject<HTMLElement | null>
  rowsRef: MutableRefObject<OutlineRow[]>
  moveSection: (headingCardIndex: number, targetIndex: number) => void
  moveCardTo: (cardIndex: number, targetIndex: number) => void
  openDoc: () => void
  onDragBegin?: () => void
  // 大纲块行拖到盒子（镜像 RiverEditor 的正文卡片拖到盒子）——可选：详细大纲
  // 大窗（OutlineDetail）没有盒子可拖，不传即可，那边 elementFromPoint 天然
  // 永远找不到 [data-box-id]，box-drop 分支自然不会触发。
  parkCardToBox?: (cardIndex: number, boxId: string) => boolean
}) {
  const outlineDragRef = useRef<OutlineDragState | null>(null)
  // 拖拽真的发生过（越过阈值）之后，紧跟着的那次原生 click 要被吞掉——不然
  // 松手落定之余，click-to-scroll 还会跟着跑一次，把视图滚去被拖动前的旧位置。
  const suppressClickRef = useRef(false)
  // onDragBegin 是调用方每次渲染内联传入的箭头函数（比如 LeftNav 传的
  // `() => setHover(null)`）——引用每次渲染都变。之前直接把它放进下面这个
  // effect 的依赖数组，导致 hover 便签的 setHover 只要一触发（真实拖拽途中，
  // 指针划过别的行会触发那些行的 onMouseEnter → openHover → setHover）就会让
  // LeftNav 重渲染、这个 effect 跟着重新挂载——重新挂载的 cleanup 会调
  // abortDrag() 把刚创建、还没来得及触发 pointerup 的拖拽态直接销毁（ghost/
  // indicator 从 DOM 里被摘掉），新一轮 effect 挂上全新、干净的
  // outlineDragRef（回到 null）。用户体感是：抓起一行刚要挪，划过第二行就
  // "掉了"——这正是本次要修的回归根因。改法跟 rowsRef 一样：把
  // onDragBegin 存进 ref，每次渲染更新，但不再是 effect 的依赖，effect 因此
  // 只在真正的挂载/卸载（以及 containerRef/moveCardTo/moveSection/openDoc
  // 这些理应稳定的引用变化）时才重新订阅一次，拖拽全程不会被中途的 hover
  // 重渲染打断。
  const onDragBeginRef = useRef(onDragBegin)
  onDragBeginRef.current = onDragBegin

  useEffect(() => {
    const railEl = containerRef.current
    if (!railEl) return

    const cleanupVisuals = (drag: OutlineDragState) => {
      drag.ghostEl.remove()
      drag.indicatorEl.remove()
      drag.sourceEls.forEach((el) => el.classList.remove('outline-row-dragging'))
      // 盒子高亮在每一条退出路径（成功 park、abort、pointercancel）都要摘掉，
      // 不留残留——跟 RiverEditor.tsx 的 cleanupDragVisuals 同一个理由。
      drag.targetBoxEl?.classList.remove(DROP_TARGET_CLASS)
      document.documentElement.classList.remove(OUTLINE_DRAG_ACTIVE_CLASS)
      try {
        railEl.releasePointerCapture(drag.pointerId)
      } catch {
        // 指针早已释放时会抛，忽略即可
      }
    }

    // 更新当前悬停命中的盒子——跟 RiverEditor.tsx 的 setDropTarget 同一份逻辑
    // （相同 boxId 提前返回，换目标时先摘旧高亮再加新高亮）。
    const setDropTarget = (drag: OutlineDragState, boxEl: HTMLElement | null) => {
      const boxId = boxEl?.dataset.boxId ?? null
      if (drag.targetBoxId === boxId) return
      drag.targetBoxEl?.classList.remove(DROP_TARGET_CLASS)
      drag.targetBoxId = boxId
      drag.targetBoxEl = boxEl
      boxEl?.classList.add(DROP_TARGET_CLASS)
    }

    // 落地收尾——dragRef 立刻置空做幂等闸门，pointerup/pointercancel/
    // lostpointercapture 无论哪个先到都只执行一次（跟 RiverEditor 的 finishDrag
    // 是同一个理由：WebKit 下 pointer capture 之后 pointerup 有时不冒泡到 window）。
    //
    // Capture only after crossing the drag threshold: an ordinary handle click
    // must reach the button so it can open the accessible move selector.
    const finishDrag = (_isPointerUp: boolean) => {
      const drag = outlineDragRef.current
      if (!drag) return
      outlineDragRef.current = null
      if (drag.moved && drag.targetBoxId) {
        // 命中盒子——只有 block 行能走到这（onPointerMove 里只给 block 行设
        // targetBoxId），park 之后不再做重排，也不做点击定位兜底。
        parkCardToBox?.(drag.startIndex, drag.targetBoxId)
        suppressClickRef.current = true
      } else if (drag.moved && drag.pendingTargetIndex !== null) {
        if (drag.kind === 'heading') moveSection(drag.startIndex, drag.pendingTargetIndex)
        else moveCardTo(drag.startIndex, drag.pendingTargetIndex)
        suppressClickRef.current = true
      }

      cleanupVisuals(drag)
    }

    const abortDrag = () => {
      const drag = outlineDragRef.current
      if (!drag) return
      outlineDragRef.current = null
      cleanupVisuals(drag)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      // 拖拽只认专门的把手（Phase 15 回归修复）：之前整行都是拖拽起点，跟
      // 行上其它手势（click-to-scroll、hover 便签的 mouseenter/mouseleave 重
      // 渲染、双击改名）抢同一个元素，行为随最近几次改动一次次被打断（见文件
      // 顶部 useOutlineRowDrag 的大段注释）。现在必须先命中
      // [data-outline-drag-handle] 才会开始拖拽——命中不了就直接放行，原生
      // click/dblclick 该怎么走怎么走，不再有 setPointerCapture 抢事件的问题。
      suppressClickRef.current = false
      const handleEl = target.closest<HTMLElement>(OUTLINE_DRAG_HANDLE_SELECTOR)
      if (!handleEl) return
      const rowEl = handleEl.closest<HTMLElement>('[data-outline-row-index]')
      if (!rowEl) return
      const index = Number(rowEl.dataset.outlineRowIndex)
      const rows = rowsRef.current
      const row = rows[index]
      if (!row) return

      const [sectionStart, sectionEnd] = outlineSectionRange(rows, index)
      const sourceEls = Array.from(railEl.querySelectorAll<HTMLElement>('[data-outline-row-index]')).filter((el) => {
        const i = Number(el.dataset.outlineRowIndex)
        return i >= sectionStart && i < sectionEnd
      })

      const ghost = document.createElement('div')
      ghost.className = 'outline-drag-ghost'
      ghost.textContent = outlineRowLabel(row).text
      ghost.style.display = 'none'
      document.body.appendChild(ghost)

      const indicator = document.createElement('div')
      indicator.className = 'outline-drop-indicator'
      indicator.style.display = 'none'
      document.body.appendChild(indicator)

      outlineDragRef.current = {
        startIndex: index,
        kind: row.kind,
        headingIndex: headingIndexAt(rows, index),
        sectionStart,
        sectionEnd,
        sourceEls,
        ghostEl: ghost,
        indicatorEl: indicator,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
        pendingTargetIndex: null,
        targetBoxId: null,
        targetBoxEl: null,
      }
    }

    const onDragStart = (e: DragEvent) => {
      if (outlineDragRef.current) e.preventDefault()
    }
    const onSelectStart = (e: Event) => {
      if (outlineDragRef.current) e.preventDefault()
    }

    // 拖拽真的越过阈值之后，紧跟的那次 click 要被吞掉，不让 handleRowClick 再
    // 跑一次把视图滚到旧位置。用捕获阶段拦在容器这一层——比 React 合成事件
    // 的冒泡阶段更早一步，stopPropagation 之后事件压根传不到行元素的 onClick。
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickRef.current) return
      suppressClickRef.current = false
      e.stopPropagation()
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent) => {
      const drag = outlineDragRef.current
      if (!drag) return
      if (!drag.moved) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.hypot(dx, dy) < OUTLINE_DRAG_MOVE_THRESHOLD_PX) return
        drag.moved = true
        suppressClickRef.current = true
        try { railEl.setPointerCapture(e.pointerId) } catch { /* unsupported capture */ }
        drag.ghostEl.style.display = 'block'
        drag.sourceEls.forEach((el) => el.classList.add('outline-row-dragging'))
        document.documentElement.classList.add(OUTLINE_DRAG_ACTIVE_CLASS)
        onDragBeginRef.current?.() // 拖起来之后 hover 便签（如果有）没意义，交给调用方关掉
      }
      drag.ghostEl.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`

      // 拖到盒子（block 行专属）：跟 RiverEditor.tsx 的 onPointerMove 同一份
      // elementFromPoint 命中判定，用 ?. 兜底——jsdom 没有实现 elementFromPoint
      // （不是"返回 null"而是压根没有这个方法），不打桩的既有重排测试因此会
      // 走 undefined?.() 短路成 undefined，行为等价于"没悬停在任何盒子上"，
      // 不会抛错、也不影响它们本来就没有盒子要测的重排断言。heading 行整段拖到
      // 盒子明确不支持（挪一整段进盒子语义不清）——即便指针悬停在盒子上也不当
      // box-drop 处理，直接清空目标、走下面的重排落点计算。
      const boxEl =
        drag.kind === 'block'
          ? (document.elementFromPoint?.(e.clientX, e.clientY)?.closest<HTMLElement>('[data-box-id]') ?? null)
          : null
      setDropTarget(drag, boxEl)
      if (boxEl) {
        // 悬停在盒子上时，重排落点线没有意义，隐藏掉避免视觉打架（同 RiverEditor）。
        drag.indicatorEl.style.display = 'none'
        return
      }

      const rows = rowsRef.current
      const others = otherOutlineRowEls(railEl, drag.sectionStart, drag.sectionEnd)
      const { targetIndex, rect } = outlineDropAt(others, e.clientY, rows.length)
      drag.pendingTargetIndex = targetIndex
      if (rect) {
        drag.indicatorEl.style.display = 'block'
        drag.indicatorEl.style.top = `${rect.top}px`
        drag.indicatorEl.style.left = `${rect.left}px`
        drag.indicatorEl.style.width = `${rect.width}px`
      } else {
        drag.indicatorEl.style.display = 'none'
      }
    }

    // pointerup 是真正的松手（可能是点击也可能是拖拽落地）；pointercancel/
    // lostpointercapture 是异常终止（比如被浏览器手势打断），不代表用户点击，
    // 不该触发定位滚动——三者都要收尾清理，但只有 pointerup 传 true。
    const onPointerUp = () => finishDrag(true)
    const onPointerCancelOrLost = () => finishDrag(false)

    railEl.addEventListener('pointerdown', onPointerDown)
    railEl.addEventListener('click', onClickCapture, true)
    window.addEventListener('pointermove', onPointerMove)
    railEl.addEventListener('pointerup', onPointerUp)
    railEl.addEventListener('pointercancel', onPointerCancelOrLost)
    railEl.addEventListener('lostpointercapture', onPointerCancelOrLost)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancelOrLost)
    window.addEventListener('lostpointercapture', onPointerCancelOrLost)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('selectstart', onSelectStart, true)
    return () => {
      railEl.removeEventListener('pointerdown', onPointerDown)
      railEl.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pointermove', onPointerMove)
      railEl.removeEventListener('pointerup', onPointerUp)
      railEl.removeEventListener('pointercancel', onPointerCancelOrLost)
      railEl.removeEventListener('lostpointercapture', onPointerCancelOrLost)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancelOrLost)
      window.removeEventListener('lostpointercapture', onPointerCancelOrLost)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      abortDrag()
    }
    // onDragBegin 特意不在依赖数组里——见上面 onDragBeginRef 的注释，它经 ref
    // 读最新值，若把它放进来，效果跟旧 bug 一样：hover 引发的重渲染会在拖拽
    // 进行到一半时把这个 effect 卸载重挂，销毁尚未 pointerup 的拖拽态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, rowsRef, moveCardTo, moveSection, openDoc, parkCardToBox])
}

// ---- 盒子行拖动重排（书内盒子，即 book.boxes）----
// 跟目录行拖拽（useOutlineRowDrag）、正文卡片拖拽（RiverEditor）同一套命令式骨架：
// 专用把手起拖、ref 存拖拽态（不进 effect 依赖）、幂等收尾、固定定位 ghost + 落点线。
// 只重排本书盒子——通用盒子的 BoxRow 不带 data-book-box-index，天然被
// otherBoxRowEls 的查询选择器排除在外，不参与这里的落点计算（Task 要求：通用盒子
// 重排是可选项，这里选择不做，靠"不给它这个 data 属性"就干净地跳过，不需要额外
// 分支判断）。
const BOX_DRAG_HANDLE_SELECTOR = '[data-box-drag-handle]'
const BOX_DRAG_MOVE_THRESHOLD_PX = 4
const BOX_ROW_DRAG_ACTIVE_CLASS = 'box-row-drag-active'
const BOOK_BOX_ROW_SELECTOR = '[data-book-box-index]'

type BoxRowDragState = {
  startBoxId: string
  sourceEl: HTMLElement
  ghostEl: HTMLElement
  indicatorEl: HTMLElement
  startX: number
  startY: number
  moved: boolean
  pointerId: number
  pendingTargetIndex: number | null
}

// 排除掉被拖那一行，按 DOM（=book.boxes）顺序返回其余本书盒子行——数组下标本身
// 就是 moveBox 要的"摘掉后再插入"下标，不需要额外换算（同 RiverEditor 的
// otherCards/dropIndexAt 那套写法）。
function otherBoxRowEls(railEl: HTMLElement, dragBoxId: string): HTMLElement[] {
  return Array.from(railEl.querySelectorAll<HTMLElement>(BOOK_BOX_ROW_SELECTOR)).filter((el) => el.dataset.boxId !== dragBoxId)
}

function boxRowDropAt(
  els: HTMLElement[],
  clientY: number,
): { targetIndex: number; rect: { top: number; left: number; width: number } | null } {
  if (els.length === 0) return { targetIndex: 0, rect: null }
  let pos = els.length
  for (let i = 0; i < els.length; i++) {
    const rect = els[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) {
      pos = i
      break
    }
  }
  let rect: { top: number; left: number; width: number }
  if (pos <= 0) {
    const r = els[0].getBoundingClientRect()
    rect = { top: r.top, left: r.left, width: r.width }
  } else if (pos >= els.length) {
    const r = els[els.length - 1].getBoundingClientRect()
    rect = { top: r.bottom, left: r.left, width: r.width }
  } else {
    const prev = els[pos - 1].getBoundingClientRect()
    const next = els[pos].getBoundingClientRect()
    rect = { top: (prev.bottom + next.top) / 2, left: next.left, width: next.width }
  }
  return { targetIndex: pos, rect }
}

function useBoxRowDrag({
  containerRef,
  moveBox,
}: {
  containerRef: RefObject<HTMLElement | null>
  moveBox: (boxId: string, targetIndex: number) => void
}) {
  const dragRef = useRef<BoxRowDragState | null>(null)
  // 真的拖拽发生过之后，紧跟的那次原生 click 要被吞掉——不然松手落在别的盒子行
  // 上，还会顺带触发那一行的"打开这个盒子"，见 useOutlineRowDrag 同名注释。
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const railEl = containerRef.current
    if (!railEl) return

    const cleanupVisuals = (drag: BoxRowDragState) => {
      drag.ghostEl.remove()
      drag.indicatorEl.remove()
      drag.sourceEl.classList.remove('box-row-dragging')
      document.documentElement.classList.remove(BOX_ROW_DRAG_ACTIVE_CLASS)
      try {
        railEl.releasePointerCapture(drag.pointerId)
      } catch {
        // 指针早已释放时会抛，忽略即可
      }
    }

    const finishDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (drag.moved && drag.pendingTargetIndex !== null) {
        moveBox(drag.startBoxId, drag.pendingTargetIndex)
        suppressClickRef.current = true
      }
      cleanupVisuals(drag)
    }

    const abortDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      cleanupVisuals(drag)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      const handleEl = target.closest<HTMLElement>(BOX_DRAG_HANDLE_SELECTOR)
      if (!handleEl) return
      const rowEl = handleEl.closest<HTMLElement>(BOOK_BOX_ROW_SELECTOR)
      if (!rowEl) return
      const boxId = rowEl.dataset.boxId
      if (!boxId) return
      e.preventDefault()

      const ghost = document.createElement('div')
      ghost.className = 'outline-drag-ghost'
      ghost.textContent = rowEl.querySelector('.box-name, .box-name-edit')?.textContent || '（盒子）'
      ghost.style.display = 'none'
      document.body.appendChild(ghost)

      const indicator = document.createElement('div')
      indicator.className = 'outline-drop-indicator'
      indicator.style.display = 'none'
      document.body.appendChild(indicator)

      dragRef.current = {
        startBoxId: boxId,
        sourceEl: rowEl,
        ghostEl: ghost,
        indicatorEl: indicator,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
        pendingTargetIndex: null,
      }
      try {
        railEl.setPointerCapture(e.pointerId)
      } catch {
        // 极少数环境不支持 setPointerCapture，忽略即可
      }
    }

    const onDragStart = (e: DragEvent) => {
      if (dragRef.current) e.preventDefault()
    }
    const onSelectStart = (e: Event) => {
      if (dragRef.current) e.preventDefault()
    }
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickRef.current) return
      suppressClickRef.current = false
      e.stopPropagation()
      e.preventDefault()
    }

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.moved) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.hypot(dx, dy) < BOX_DRAG_MOVE_THRESHOLD_PX) return
        drag.moved = true
        drag.ghostEl.style.display = 'block'
        drag.sourceEl.classList.add('box-row-dragging')
        document.documentElement.classList.add(BOX_ROW_DRAG_ACTIVE_CLASS)
      }
      drag.ghostEl.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`

      const others = otherBoxRowEls(railEl, drag.startBoxId)
      const { targetIndex, rect } = boxRowDropAt(others, e.clientY)
      drag.pendingTargetIndex = targetIndex
      if (rect) {
        drag.indicatorEl.style.display = 'block'
        drag.indicatorEl.style.top = `${rect.top}px`
        drag.indicatorEl.style.left = `${rect.left}px`
        drag.indicatorEl.style.width = `${rect.width}px`
      } else {
        drag.indicatorEl.style.display = 'none'
      }
    }

    const onPointerUp = () => finishDrag()
    const onPointerCancelOrLost = () => finishDrag()

    railEl.addEventListener('pointerdown', onPointerDown)
    railEl.addEventListener('click', onClickCapture, true)
    window.addEventListener('pointermove', onPointerMove)
    railEl.addEventListener('pointerup', onPointerUp)
    railEl.addEventListener('pointercancel', onPointerCancelOrLost)
    railEl.addEventListener('lostpointercapture', onPointerCancelOrLost)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancelOrLost)
    window.addEventListener('lostpointercapture', onPointerCancelOrLost)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('selectstart', onSelectStart, true)
    return () => {
      railEl.removeEventListener('pointerdown', onPointerDown)
      railEl.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pointermove', onPointerMove)
      railEl.removeEventListener('pointerup', onPointerUp)
      railEl.removeEventListener('pointercancel', onPointerCancelOrLost)
      railEl.removeEventListener('lostpointercapture', onPointerCancelOrLost)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancelOrLost)
      window.removeEventListener('lostpointercapture', onPointerCancelOrLost)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      abortDrag()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, moveBox])
}

export function LeftNav() {
  const book = useBookStore((s) => s.activeBook())
  const universalBoxes = useBookStore((s) => s.library.universalBoxes)
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const openDoc = useBookStore((s) => s.openDoc)
  const openBox = useBookStore((s) => s.openBox)
  const addBox = useBookStore((s) => s.addBox)
  const renameBox = useBookStore((s) => s.renameBox)
  const renameUniversalBox = useBookStore((s) => s.renameUniversalBox)
  const moveBox = useBookStore((s) => s.moveBox)
  const carry = useBookStore((s) => s.carry)
  const setHeadingNote = useEditorBridge((s) => s.setHeadingNote)
  const setCardNote = useEditorBridge((s) => s.setCardNote)
  const addChapter = useEditorBridge((s) => s.addChapter)
  const bridgeMoveCardTo = useEditorBridge((s) => s.moveCardTo)
  const bridgeMoveSection = useEditorBridge((s) => s.moveSection)
  const bridgeToggleCollapsed = useEditorBridge((s) => s.toggleCollapsed)
  const bridgeParkOutlineCardToBox = useEditorBridge((s) => s.parkOutlineCardToBox)

  const rows = outlineTreeFromDoc(book?.doc)
  // 折叠态过滤（Phase 13 Task 2）：collapsed 的标题行不渲染它管辖的后代行——
  // visibleOutlineRows 保留每行在完整 rows 里的原始下标（=cardIndex），下面渲染
  // 时继续拿它当 data-outline-row-index / headingIndices 的键，跟拖拽逻辑用的
  // 是同一份下标体系，过滤只影响"渲染谁"，不影响下标含义。
  const visibleRows = visibleOutlineRows(rows)
  // 拖拽事件里要读"当下"的 rows（算落点、算被拖行的段范围），但 rows 每次渲染
  // 都重新算、引用不稳定——effect 不能把它放进依赖数组（会导致拖拽中途因为别处
  // 触发的重渲染而被重挂载、拖拽态被打断，比如 hover 便签的 state 变化）。用 ref
  // 兜底：每次渲染都把最新 rows 写进去，effect 内部读 ref，不订阅它的变化。
  const rowsRef = useRef(rows)
  rowsRef.current = rows
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
    if (!NOTE_EDITING_ENABLED) return
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

  const railRef = useRef<HTMLElement | null>(null)
  // 目录内拖动重排（Phase 12 Task 3）：抽出的通用 hook（Phase 14 Task 2），
  // 侧栏简略树、大窗详细视图共用同一份逻辑——这里额外传 onDragBegin 关掉 hover
  // 便签（详细视图没有 hover 便签，OutlineDetail 调用时不传）。
  useOutlineRowDrag({
    containerRef: railRef,
    rowsRef,
    moveSection: bridgeMoveSection,
    moveCardTo: bridgeMoveCardTo,
    openDoc,
    onDragBegin: () => setHover(null),
    parkCardToBox: bridgeParkOutlineCardToBox,
  })
  useBoxRowDrag({ containerRef: railRef, moveBox })

  // Phase 14 Task 2：详细大纲搬进悬浮大窗——侧栏只留简略树 + 这一个按钮开窗。
  const [detailOpen, setDetailOpen] = useState(false)

  // Phase 14 Task 4：书内点某个通用盒子也用悬浮大窗打开（不再走 openBox/viewKind
  // 那条给"本书盒子"用的路）——readOnly=false，书内有当前 doc，插入按钮可用。
  const [openUniversalBoxId, setOpenUniversalBoxId] = useState<string | null>(null)

  return (
    <>
    <nav aria-label="目录和盒子" className="rail" ref={(el) => { railRef.current = el }} onScroll={closeHoverForScroll}>
      {/* 目录头做成 sticky：栏内大纲很长往下滚时，这条「目录 + 排列」始终吸在
          栏顶。「排列」是缩小版的原"详细 / 排列大纲"按钮，挪到标题右侧省地方。 */}
      <div className="rail-outline-head">
        <p className="rlabel nav-group">目录</p>
        <button
          type="button"
          className="outline-arrange-btn"
          title="详细 / 排列大纲"
          onClick={() => setDetailOpen(true)}
        >
          排列
        </button>
      </div>
      {!hasHeadings ? (
        <>
          <p className="outline-hint">还没有章节标题</p>
          <button type="button" className="add" onClick={() => addChapter()}>
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            新章节
          </button>
        </>
      ) : (
        <>
          {visibleRows.map(({ row, index: i }) => {
            const label = outlineRowLabel(row)
            return (
              <div
                key={row.cardIndex}
                className="outline-item-wrap"
                data-outline-row-index={i}
                data-outline-kind={row.kind}
                data-row-color={row.bg}
                style={outlineRowStyle(row)}
                onMouseEnter={(e) => openHover(row, headingIndices[i], e.currentTarget)}
                onMouseLeave={scheduleCloseHover}
              >
                <div
                  className={outlineRowClassName(row)}
                  onClick={() => handleRowClick(row, headingIndices[i])}
                >
                  {row.kind === 'heading' && (
                    <OutlineCollapseTriangle
                      row={row}
                      hasDescendants={outlineRowHasDescendants(rows, i)}
                      onToggle={() => bridgeToggleCollapsed(row.cardIndex)}
                    />
                  )}
                  <button type="button" className={outlineRowTextClassName(row, label.faint)} onClick={(e) => { e.stopPropagation(); handleRowClick(row, headingIndices[i]) }} aria-label={`跳到：${label.text}`}>{label.text}</button>
                  {row.kind === 'heading' && row.collapsed && (
                    <span className="outline-collapsed-marker" aria-hidden="true">⋯</span>
                  )}
                  <OutlineWordCount words={outlineRowWords(rows, i)} />
                </div>
                <OutlineDragHandle rows={rows} index={i} />
              </div>
            )
          })}
          <button type="button" className="add" onClick={() => addChapter()}>
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            新章节
          </button>
        </>
      )}
      {NOTE_EDITING_ENABLED && hover &&
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
      {(book?.boxes ?? []).map((b, i) => (
        <BoxRow
          key={b.id}
          box={b}
          active={b.id === activeBoxId && viewKind === 'box'}
          collapsed={collapsedBoxIds.has(b.id)}
          onOpen={() => openBox(b.id)}
          onToggleCollapsed={() => toggleBoxCollapsed(b.id)}
          onCarryCard={(cardId) => carry(b.id, cardId)}
          onRename={(name) => renameBox(b.id, name)}
          draggable
          dragIndex={i}
        />
      ))}
      <button type="button"
        className="add"
        onClick={() => {
          const b = addBox('新盒子')
          if (b) openBox(b.id)
        }}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        新盒子
      </button>
      {/* 通用盒子不属于本书，跟本书的盒子隔一条浅分隔线，并带一个共享图标——
          提示这是跨所有书共享的同一个盒子，而不是本书的第 N 个盒子。Phase 14
          起支持多个通用盒子，全部列出；点开的是悬浮大窗而不是 viewKind==='box'
          那条只给本书盒子用的路（openUniversalBoxId 由此驱动 UniversalBoxModal）。 */}
      <div className="universal-box-divider" />
      {universalBoxes.map((box) => (
        <BoxRow
          key={box.id}
          box={box}
          active={box.id === openUniversalBoxId}
          collapsed={collapsedBoxIds.has(box.id)}
          onOpen={() => setOpenUniversalBoxId(box.id)}
          onToggleCollapsed={() => toggleBoxCollapsed(box.id)}
          onCarryCard={(cardId) => carry(box.id, cardId)}
          onRename={(name) => renameUniversalBox(box.id, name)}
          opensOverlay
          icon={<Package size={14} strokeWidth={1.75} />}
          extraClassName="universal-box"
        />
      ))}
    </nav>
    <Modal open={detailOpen} title="详细大纲" onClose={() => setDetailOpen(false)}>
      <OutlineDetail />
    </Modal>
    <UniversalBoxModal boxId={openUniversalBoxId} onClose={() => setOpenUniversalBoxId(null)} />
    </>
  )
}

// 一个盒子在侧栏里的一行：盒名（点它开该盒子的完整 BoxView）+ 一个折叠箭头
// （单独点它才切换是否展开卡片列表，跟"打开盒子"分开，不会互相打架）+ 展开时
// 缩进列出该盒子的卡片预览。整行（含卡片列表）都在同一个 [data-box-id] 元素
// 内——拖卡到盒子时用 elementFromPoint().closest('[data-box-id]') 找落点
// （见 RiverEditor.tsx），落在卡片预览行上也照样能命中这个盒子。
// 通用盒子的 onOpen 会铺出一个悬浮大窗（UniversalBoxModal），这个大窗会盖住
// 侧栏这一行——双击手势的第二下 click 落到大窗（或它的遮罩）上而不是盒名上，
// 原生 dblclick 也就永远等不到。真机上验证过：单击先开了窗，窗盖住这一行，
// 第二下点击/原生 dblclick 都打在窗上，改名压根进不去。普通盒子的 onOpen 只是
// 切 viewKind（不铺任何东西盖住这一行），没有这个问题，不需要下面这套延迟判定。
// 用一个短延迟去抖：单击先不着急开，等一小段时间——这段时间里如果第二下点击
// 到达（说明是双击），就取消这次"开"，直接进入改名态；没有第二下，延迟结束后
// 再真正 onOpen()。
const OVERLAY_CLICK_DISAMBIGUATE_MS = 250

function BoxRow({
  box,
  active,
  collapsed,
  onOpen,
  onToggleCollapsed,
  onCarryCard,
  onRename,
  opensOverlay,
  icon,
  extraClassName,
  draggable,
  dragIndex,
}: {
  box: Box
  active: boolean
  collapsed: boolean
  onOpen: () => void
  onToggleCollapsed: () => void
  onCarryCard: (cardId: string) => void
  onRename: (name: string) => void
  opensOverlay?: boolean
  icon?: ReactNode
  extraClassName?: string
  // 拖动重排把手（useBoxRowDrag）——只有本书盒子传 true + dragIndex，通用盒子不传，
  // 天然没有 data-book-box-index、也不渲染把手，重排逻辑查询不到它，等于跳过
  // （Task 明确允许通用盒子重排可选，这里选择不做）。
  draggable?: boolean
  dragIndex?: number
}) {
  const cards = box.cards ?? []
  // 盒名双击改名（跟 Bookshelf 的 BookCard/UniversalBoxEntry 同一套手感）：本地
  // editing/draft 撑显示，Enter/失焦提交，空名（trim 后）忽略不提交。编辑态时
  // header 的 onClick 用 editing 挡住，不会同时触发"打开这个盒子"；输入框自己
  // 的 onClick 也 stopPropagation 兜底。拖拽到盒子（drag-to-box）走的是
  // elementFromPoint().closest('[data-box-id]')，跟这里的编辑态无关，不受影响。
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(box.name)
  const pendingOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (pendingOpenTimer.current) clearTimeout(pendingOpenTimer.current)
  }, [])

  const commitRename = () => {
    const name = draft.trim()
    if (name && name !== box.name) onRename(name)
    setEditing(false)
  }

  const handleHeaderClick = () => {
    if (editing) return
    if (!opensOverlay) {
      onOpen()
      return
    }
    if (pendingOpenTimer.current) {
      // 短延迟内的第二下点击——当成双击，取消这次"开"，直接进入改名态。
      clearTimeout(pendingOpenTimer.current)
      pendingOpenTimer.current = null
      setDraft(box.name)
      setEditing(true)
      return
    }
    pendingOpenTimer.current = setTimeout(() => {
      pendingOpenTimer.current = null
      onOpen()
    }, OVERLAY_CLICK_DISAMBIGUATE_MS)
  }

  return (
    <div
      data-box-id={box.id}
      data-book-box-index={draggable ? dragIndex : undefined}
      className={'chap box-row' + (extraClassName ? ' ' + extraClassName : '') + (active ? ' on' : '')}
    >
      <div className="box-row-header" onClick={handleHeaderClick}>
        <button type="button"
          className="box-chevron"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开' : '折叠'}
          data-collapsed={collapsed}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapsed()
          }}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
        {icon && (
          <span className="universal-box-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {editing ? (
          <input
            className="box-name-edit" aria-label="盒子名称"
            value={draft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(box.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <button type="button"
            className="box-name"
            onClick={(e) => { e.stopPropagation(); onOpen() }}
            onKeyDown={(e) => { if (e.key === "F2") { e.preventDefault(); setDraft(box.name); setEditing(true) } }}
            aria-label={`打开盒子：${box.name}（F2 重命名）`}
            onDoubleClick={(e) => {
              e.stopPropagation()
              // 普通盒子这里是唯一的双击入口；通用盒子理论上已经被 handleHeaderClick
              // 的"第二下点击"分支抢先处理掉了（原生 dblclick 都在那之后才触发），
              // 这里只是兜底清掉可能还挂着的延迟"开"定时器，双保险不留隐患。
              if (pendingOpenTimer.current) {
                clearTimeout(pendingOpenTimer.current)
                pendingOpenTimer.current = null
              }
              setDraft(box.name)
              setEditing(true)
            }}
          >
            {box.name}
          </button>
        )}
        {draggable && (
          <span
            className="box-drag-handle"
            data-box-drag-handle
            aria-hidden="true"
            title="拖动排序"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} strokeWidth={1.75} />
          </span>
        )}
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
                  title="插入正文" aria-label={`将卡片插入正文：${preview.text}`}
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
