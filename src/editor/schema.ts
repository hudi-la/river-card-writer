import { Node, Extension, InputRule, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Placeholder from '@tiptap/extension-placeholder'
import { UndoRedo } from '@tiptap/extensions'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EditorState, Plugin, Transaction, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { nanoid } from 'nanoid'
import { CardView } from './CardView'
import { Emphasis, Refer, Strike } from './marks'
import { isValidEn, UNCONFIRMED, splitEn, mergeEn, confirmState, type EnState } from './enText'

export const CardDocument = Document.extend({ content: 'card+' })

// 段落样式：'body'（正文，默认）/'chapter'（章名）/'h1'/'h2'（层级标题）/
// 'bullet'（列表项）/'quote'（引用）/'note'（注）。
// 渲染成 data-style，样式表按这个属性走视觉区分。
// 列表/引用/注跟标题一样只是段落的一个属性，不是嵌套结构——连着几段 bullet 在
// 视觉上就是一个列表；大纲、折叠、字数这些只认 chapter/h1/h2 的逻辑把它们当正文。
export type ParagraphStyle = 'body' | 'chapter' | 'h1' | 'h2' | 'bullet' | 'quote' | 'note'

// "块样式"：回车会延续（写列表时一路回车一路是列表项），空段回车/段首退格则退回正文，
// 跟常见编辑器里的列表手感一致。标题不在其列——标题的回车/退格行为保持原样。
const BLOCK_STYLES: ReadonlySet<string> = new Set(['bullet', 'quote', 'note'])

// 光标（空选区）所在段落是块样式时返回它的位置和节点，否则 null。
function blockStyledParagraphAtCursor(state: EditorState): { pos: number; node: PMNode } | null {
  const { $from, empty } = state.selection
  if (!empty) return null
  const node = $from.parent
  if (node.type.name !== 'paragraph' || !BLOCK_STYLES.has(node.attrs.style)) return null
  return { pos: $from.before(), node }
}

// 段首敲 markdown 式标记就换样式：`- `/`* ` → 列表，`> `/`》 ` → 引用（中文输入法下
// 打 > 出来的是 》）。只对正文段落生效，标记字符本身被吃掉。
function blockStyleInputRule(find: RegExp, style: ParagraphStyle) {
  return new InputRule({
    find,
    handler: ({ state, range }) => {
      const $start = state.doc.resolve(range.from)
      const para = $start.parent
      if (para.type.name !== 'paragraph' || para.attrs.style !== 'body') return null
      state.tr.delete(range.from, range.to).setNodeAttribute($start.before(), 'style', style)
    },
  })
}

export const ParagraphWithStyle = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: 'body',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-style') || 'body',
        renderHTML: (attrs: { style: ParagraphStyle }) => ({ 'data-style': attrs.style }),
      },
      // 标题的梗概/说明——纯元数据，不进正文渲染。有值时才落一个隐藏的
      // data-note 属性用来在 HTML 往返时保住它；没有 note 的老段落解析出来
      // 就是默认空串，完全向后兼容。
      note: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-note') || '',
        renderHTML: (attrs: { note: string }) => (attrs.note ? { 'data-note': attrs.note } : {}),
      },
      // 章/节标题的折叠状态——只在 heading 段落（chapter/h1/h2）上有意义，正文段落
      // 忽略它。默认 false，老文档（JSON/HTML 里没有 data-collapsed）解析出来也是
      // false，完全向后兼容、零行为变化。
      collapsed: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-collapsed') === 'true',
        renderHTML: (attrs: { collapsed: boolean }) => (attrs.collapsed ? { 'data-collapsed': 'true' } : {}),
      },
    }
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setParagraphStyle:
        (style: ParagraphStyle) =>
        ({ state, dispatch }) => {
          const { selection } = state
          const positions: number[] = []
          state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
            if (node.type.name === 'paragraph') positions.push(pos)
          })
          if (positions.length === 0) {
            const { $from } = selection
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'paragraph') {
                positions.push($from.before(d))
                break
              }
            }
          }
          if (positions.length === 0) return false
          if (dispatch) {
            const tr = state.tr
            positions.forEach((pos) => tr.setNodeAttribute(pos, 'style', style))
            dispatch(tr)
          }
          return true
        },
      // 工具栏里列表/引用/注按钮用：光标所在段已经是这个样式就退回正文，否则设成它。
      toggleParagraphStyle:
        (style: ParagraphStyle) =>
        ({ editor, commands }) =>
          commands.setParagraphStyle(editor.isActive('paragraph', { style }) ? 'body' : style),
      setHeadingNote:
        (headingIndex: number, note: string) =>
        ({ state, dispatch }) => {
          // 按文档顺序数第 headingIndex 个 chapter/h1/h2 段落——顺序与
          // outlineFromDoc（仅 chapter/h1）以及 outlineTreeFromDoc（chapter/h1/h2
          // 都算 heading 行）的编号规则保持一致。h2 也要算进来，否则大纲树里的
          // 三级标题行传进来的 headingIndex 会对不上，改到别的标题头上去。
          let targetPos = -1
          let count = 0
          state.doc.descendants((node, pos) => {
            if (targetPos !== -1) return false
            if (
              node.type.name === 'paragraph' &&
              (node.attrs.style === 'chapter' || node.attrs.style === 'h1' || node.attrs.style === 'h2')
            ) {
              if (count === headingIndex) targetPos = pos
              count++
            }
          })
          if (targetPos === -1) return false
          if (dispatch) dispatch(state.tr.setNodeAttribute(targetPos, 'note', note))
          return true
        },
      toggleCollapsed:
        (headingCardIndex: number) =>
        ({ state, dispatch }) => {
          // 定位 doc.content 第 headingCardIndex 张 card 里的（第一个）heading 段落——
          // 下标规则跟 moveSection/setCardNote 一致，按 doc 顶层 child 序号数。
          const doc = state.doc
          if (headingCardIndex < 0 || headingCardIndex >= doc.childCount) return false
          const cardNode = doc.child(headingCardIndex)
          let cardOffset = 0
          for (let i = 0; i < headingCardIndex; i++) cardOffset += doc.child(i).nodeSize
          let targetPos = -1
          cardNode.forEach((paragraph, offsetInCard) => {
            if (targetPos !== -1) return
            if (paragraph.type.name !== 'paragraph') return
            const style = paragraph.attrs.style
            if (style === 'chapter' || style === 'h1' || style === 'h2') {
              // +1 跨过 card 节点自身的开始标记，进入其内容位置
              targetPos = cardOffset + 1 + offsetInCard
            }
          })
          if (targetPos === -1) return false // 不是标题卡，没有 collapsed 可翻
          if (dispatch) {
            const node = state.doc.nodeAt(targetPos)!
            dispatch(state.tr.setNodeAttribute(targetPos, 'collapsed', !node.attrs.collapsed))
          }
          return true
        },
    }
  },
  // Paragraph 的 priority 是 1000，高于 Card（默认 100）——所以这里的 Backspace 先于
  // Card 的 mergeCardBackward 被尝试：块样式段落在卡首退格，先退回正文而不是合卡。
  addKeyboardShortcuts() {
    const resetToBody = () => {
      const hit = blockStyledParagraphAtCursor(this.editor.state)
      if (!hit) return false
      this.editor.view.dispatch(this.editor.state.tr.setNodeAttribute(hit.pos, 'style', 'body'))
      return true
    }
    return {
      ...this.parent?.(),
      // 空的列表项/引用/注里回车 = 结束这个块，退回正文（不另生一段）。
      Enter: () => {
        const hit = blockStyledParagraphAtCursor(this.editor.state)
        return !!hit && hit.node.content.size === 0 && resetToBody()
      },
      Backspace: () => this.editor.state.selection.$from.parentOffset === 0 && resetToBody(),
    }
  },
  addInputRules() {
    return [blockStyleInputRule(/^[-*]\s$/, 'bullet'), blockStyleInputRule(/^[>》]\s$/, 'quote')]
  },
})

// 每张卡的底色调色板（低饱和度色块，风格与原来的 THREAD_PALETTE 一致）。
export const CARD_PALETTE = ['#7fa3c4', '#d98b7a', '#8bad86', '#d8b46a', '#a98cc4', '#6bb0ad']

// 没手动设色的卡也要有稳定、可分辨的默认底色：逐字符哈希 cardId 落进调色板。
export function autoCardColor(cardId: string): string {
  let h = 0
  for (let i = 0; i < cardId.length; i++) h = (h * 31 + cardId.charCodeAt(i)) | 0
  return CARD_PALETTE[Math.abs(h) % CARD_PALETTE.length]
}

// 一张卡此刻渲染出来的底色——手动设了 color 就用它，否则按 cardId 哈希；跟
// CardView / LeftNav 完全同一条公式（判断"撞色"必须跟眼睛看到的是同一把尺子）。
// 还没拿到 cardId 的新卡返回 null：它的色这一轮才定下来，在那之前不该参与别人的
// 撞色判断——否则一串同时出生的卡会被一个根本不存在的颜色互相误伤。
function cardColorOf(node: PMNode): string | null {
  if (node.type.name !== 'card') return null
  if (node.attrs.color) return node.attrs.color
  return node.attrs.cardId ? autoCardColor(node.attrs.cardId) : null
}

// 掷 id 的次数上限。banned 最多装两个邻居的色，6 色调色板里还剩 4 个候选，期望
// 一两次就中；这个上限纯粹是保命用的——宁可撞一次色也不能让输入卡死。
const MAX_ID_DRAWS = 20

// 给一张新卡挑 cardId：颜色（= autoCardColor(id)）落在 banned 里就重掷。
// 颜色仍然是 cardId 的纯函数，所以这条规则只在"出生"那一刻生效一次，之后这张卡
// 拖到哪儿都不会变色——颜色是它的身份，不是它的位置。
export function pickCardId(banned: Set<string>, gen: () => string = nanoid): string {
  let id = gen()
  for (let i = 1; i < MAX_ID_DRAWS && banned.has(autoCardColor(id)); i++) id = gen()
  return id
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphStyle: {
      setParagraphStyle: (style: ParagraphStyle) => ReturnType
      toggleParagraphStyle: (style: ParagraphStyle) => ReturnType
      setHeadingNote: (headingIndex: number, note: string) => ReturnType
      toggleCollapsed: (headingCardIndex: number) => ReturnType
    }
    card: {
      splitCard: () => ReturnType
      mergeCardBackward: () => ReturnType
      moveCardUp: () => ReturnType
      moveCardDown: () => ReturnType
      moveCardTo: (cardId: string, targetIndex: number) => ReturnType
      moveSection: (headingCardIndex: number, targetIndex: number) => ReturnType
      insertCardAfter: () => ReturnType
      appendCard: () => ReturnType
      addChapterHeading: () => ReturnType
      setCardColor: (color: string | null) => ReturnType
      setCardNote: (cardIndex: number, note: string) => ReturnType
      removeCard: () => ReturnType
      insertCardJSONAfter: (cardJSON: any, pos: number) => ReturnType
    }
  }
}

function emptyCardNode(schema: EditorState['schema']) {
  const paragraph = schema.nodes.paragraph.createAndFill()!
  return schema.nodes.card.create({ cardId: null, color: null }, paragraph)
}

// 同 emptyCardNode，但段落带上 style:'chapter'——给"＋ 新章节"用：新卡一落地就是
// 一个（空文本的）章名段落，outlineFromDoc 立刻能认出它、大纲里多一条。
function emptyChapterCardNode(schema: EditorState['schema']) {
  const paragraph = schema.nodes.paragraph.createAndFill({ style: 'chapter' })!
  return schema.nodes.card.create({ cardId: null, color: null }, paragraph)
}

// 把光标所在 card 与其上一个(-1)/下一个(+1) 兄弟 card 交换位置
function moveCard(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1): boolean {
  const { $from } = state.selection
  let cardDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'card') {
      cardDepth = d
      break
    }
  }
  if (cardDepth === -1) return false
  const index = $from.index(0) // card 在 doc 里的序号
  const parent = state.doc
  const target = index + dir
  if (target < 0 || target >= parent.childCount) return false
  if (dispatch) {
    const cardNode = parent.child(index)
    const cardPos = $from.before(cardDepth)
    if (dir === 1) {
      // 与下一个 card 交换：把当前 card 挪到下一个 card 后面
      const nextNode = parent.child(index + 1)
      const tr = state.tr
      tr.delete(cardPos, cardPos + cardNode.nodeSize)
      const insertPos = cardPos + nextNode.nodeSize
      tr.insert(insertPos, cardNode)
      dispatch(tr.scrollIntoView())
    } else {
      // 与上一个 card 交换：把当前 card 挪到上一个 card 前面
      const prevNode = parent.child(index - 1)
      const prevPos = cardPos - prevNode.nodeSize
      const tr = state.tr
      tr.delete(cardPos, cardPos + cardNode.nodeSize)
      tr.insert(prevPos, cardNode)
      dispatch(tr.scrollIntoView())
    }
  }
  return true
}

// 把 cardId 指定的卡挪到 targetIndex —— 语义是"先从文档里摘掉这张卡，再把它插入到
// 剩下那串卡（长度 = 原 childCount - 1）里第 targetIndex 个位置"，即标准的拖拽排序
// splice 语义：move(A, 2) on [A,B,C] → 摘掉 A 剩 [B,C] → 插到 index2（末尾）→ [B,C,A]。
function moveCardToIndex(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, cardId: string, targetIndex: number): boolean {
  const doc = state.doc
  let dragPos = -1
  let dragNode: PMNode | null = null
  let offset = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (dragPos === -1 && child.type.name === 'card' && child.attrs.cardId === cardId) {
      dragPos = offset
      dragNode = child
    }
    offset += child.nodeSize
  }
  if (dragPos === -1 || !dragNode) return false
  const node: PMNode = dragNode
  const clamped = Math.max(0, Math.min(targetIndex, doc.childCount - 1))
  if (dispatch) {
    const tr = state.tr
    tr.delete(dragPos, dragPos + node.nodeSize)
    // 删除之后重新在（剩下的）doc 里数到第 clamped 个 child 的 offset 作为插入点；
    // 数不到（clamped 落在末尾之外）就插到文档末尾。
    let insertPos: number | null = null
    let idx = 0
    tr.doc.forEach((_node, offset) => {
      if (idx === clamped && insertPos === null) insertPos = offset
      idx++
    })
    tr.insert(insertPos === null ? tr.doc.content.size : insertPos, node)
    dispatch(tr.scrollIntoView())
  }
  return true
}

// 这张卡是不是一张"标题卡"——第一个带 chapter/h1/h2 style 的段落决定它的层级
// （1=chapter，2=h1，3=h2），跟 outlineTreeFromDoc 的 headingLevel 规则一致。
// 不是标题卡（纯正文块）返回 null。
function cardHeadingLevel(card: PMNode): 1 | 2 | 3 | null {
  let level: 1 | 2 | 3 | null = null
  card.forEach((paragraph) => {
    if (level !== null) return
    if (paragraph.type.name !== 'paragraph') return
    const style = paragraph.attrs.style
    if (style === 'chapter') level = 1
    else if (style === 'h1') level = 2
    else if (style === 'h2') level = 3
  })
  return level
}

// 在（当前）doc 的顶层子节点里找 cardId 匹配的那张卡，返回它的起始 pos 与 JSON——
// 拖到盒子（park，包括从正文河流拖、从大纲块行拖两条路径）和普通拖拽重排都要先
// 定位这张卡。定义在这里（而不是 RiverEditor.tsx）是为了让 editorBridge.ts 也能
// 直接引用，不必反过来 import RiverEditor.tsx（会形成 editorBridge <-> RiverEditor
// 的循环依赖）；RiverEditor.tsx 继续 re-export 一份，保持既有调用方/测试的 import
// 路径不变。
export function findCardInDoc(doc: PMNode, cardId: string): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null
  doc.forEach((node, offset) => {
    if (!found && node.type.name === 'card' && node.attrs.cardId === cardId) {
      found = { pos: offset, node }
    }
  })
  return found
}

// 标题卡 headingCardIndex 的"段正文"范围——它自己之后、直到下一张 level ≤ 它的
// 标题卡之前的所有卡下标（含中间夹着的更深层子节/正文块，不含标题卡自己）。
// [startExclusive, endExclusive) 左闭右开，跟 Array.slice 一致。非标题卡（没有
// "段"这个概念）或下标越界时返回 [headingCardIndex, headingCardIndex]（空区间）。
// moveSection 与 hiddenCardIndices 共用这份边界计算，保证"挪整段"和"折叠整段"
// 认的是同一个范围。
export function sectionRange(doc: PMNode, headingCardIndex: number): [number, number] {
  if (headingCardIndex < 0 || headingCardIndex >= doc.childCount) return [headingCardIndex, headingCardIndex]
  const level = cardHeadingLevel(doc.child(headingCardIndex))
  if (level === null) return [headingCardIndex, headingCardIndex]
  const start = headingCardIndex + 1
  let end = doc.childCount
  for (let i = start; i < doc.childCount; i++) {
    const l = cardHeadingLevel(doc.child(i))
    if (l !== null && l <= level) {
      end = i
      break
    }
  }
  return [start, end]
}

// 遍历全文所有 collapsed 的标题段落，收集其"段正文"（sectionRange）覆盖到的
// card 下标——标题卡自己不算隐藏，只隐藏它后面那段。多个 collapsed 标题（含
// 嵌套：外层章 collapsed 时，其子节即便自己没 collapsed 也已经在外层段范围内）
// 靠 Set 自然去重、自然覆盖，不用特殊处理嵌套。没有任何 collapsed 标题时返回
// 空集——老文档 / 未使用折叠功能时零行为变化。
export function hiddenCardIndices(doc: PMNode): Set<number> {
  const hidden = new Set<number>()
  for (let i = 0; i < doc.childCount; i++) {
    if (!isCollapsedHeadingCard(doc.child(i))) continue
    const [start, end] = sectionRange(doc, i)
    for (let j = start; j < end; j++) hidden.add(j)
  }
  return hidden
}

// 这张卡是不是一张"已折叠"的标题卡——即它的（唯一）heading 段落 collapsed 为 true。
function isCollapsedHeadingCard(card: PMNode): boolean {
  let collapsed = false
  card.forEach((paragraph) => {
    if (collapsed) return
    if (paragraph.type.name !== 'paragraph') return
    const style = paragraph.attrs.style
    if ((style === 'chapter' || style === 'h1' || style === 'h2') && paragraph.attrs.collapsed) collapsed = true
  })
  return collapsed
}

// 把 headingCardIndex 指定的标题卡「整段」——它自己 + 其后直到下一张 level ≤ 它
// 的标题卡之前的所有卡（含中间夹着的更深层子节/正文块）——搬到 targetIndex。
// targetIndex 语义跟 moveCardTo 不同：这里是「原 doc.content 里的下标，插到当前
// 排在这个下标的卡之前」（targetIndex===doc.childCount 表示插到末尾），而不是
// moveCardTo 那种「先摘掉、再在剩下那串里数下标」的 splice 语义——多卡搬家时
// splice 语义没法从外部一次算准（摘掉几张要看整段多长），干脆让命令自己认
// "原下标"更简单，也正好跟 LeftNav 大纲行的下标（对应 outlineTreeFromDoc 的
// cardIndex）直接对上，调用方不用做换算。
function moveSectionToIndex(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  headingCardIndex: number,
  targetIndex: number,
): boolean {
  const doc = state.doc
  if (headingCardIndex < 0 || headingCardIndex >= doc.childCount) return false
  const level = cardHeadingLevel(doc.child(headingCardIndex))
  if (level === null) return false // 不是标题卡，没有"整段"可搬

  const startIndex = headingCardIndex
  const [, endIndex] = sectionRange(doc, headingCardIndex)
  if (startIndex === 0 && endIndex === doc.childCount) {
    // 整段就是整份文档——没有别的卡可供参照重排，天然是 no-op。也避开下面
    // delete 整个 doc 到 0 张卡时，ProseMirror 会自动塞一张空卡补齐 schema
    // "card+"（至少一张）的下限，导致原内容 + 一张多余空卡都留在文档里的坑。
    return true
  }
  const clampedTarget = Math.max(0, Math.min(targetIndex, doc.childCount))
  if (!dispatch) return true

  // 收集要搬的节点，以及这一段在当前 doc 里的起止字符位置。
  const nodes: PMNode[] = []
  let startPos = -1
  let endPos = -1
  let offset = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (i === startIndex) startPos = offset
    if (i >= startIndex && i < endIndex) nodes.push(child)
    offset += child.nodeSize
    if (i === endIndex - 1) endPos = offset
  }
  if (startPos === -1 || endPos === -1) return false

  const tr = state.tr
  tr.delete(startPos, endPos)

  // 数一下原 doc 里排在 clampedTarget 之前、且不属于被搬走这一段的卡有几张——
  // 这就是搬走整段之后，在剩下那串卡里应该插入的下标（跟 moveCardTo 的 splice
  // 语义等价，只是这里"摘掉"的是一整段而不是一张卡）。
  let insertIdx = 0
  for (let i = 0; i < doc.childCount; i++) {
    if (i >= startIndex && i < endIndex) continue
    if (i < clampedTarget) insertIdx++
  }
  let insertPos: number | null = null
  let idx = 0
  tr.doc.forEach((_node, off) => {
    if (idx === insertIdx && insertPos === null) insertPos = off
    idx++
  })
  const insertAt = insertPos === null ? tr.doc.content.size : insertPos
  tr.insert(insertAt, Fragment.fromArray(nodes))
  dispatch(tr.scrollIntoView())
  return true
}

// 一张卡的每一段中文文本。指纹和切分对齐都以它为输入。
function cardParagraphTexts(cardNode: PMNode): string[] {
  const out: string[] = []
  cardNode.forEach((p) => out.push(p.textContent))
  return out
}

// 把一份 EnState 落到指定位置的卡上。enAt 只在真的有英文时才盖时间戳。
function applyEnState(tr: Transaction, pos: number, s: EnState, now: string): void {
  tr.setNodeAttribute(pos, 'en', s.en)
  tr.setNodeAttribute(pos, 'enSrc', s.enSrc)
  if (s.en) tr.setNodeAttribute(pos, 'enAt', now)
}

export const Card = Node.create({
  name: 'card',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      cardId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-card-id'),
        renderHTML: (attrs) => (attrs.cardId ? { 'data-card-id': attrs.cardId } : {}),
      },
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-color'),
        renderHTML: (attrs) => (attrs.color ? { 'data-color': attrs.color } : {}),
      },
      // 卡片的梗概/说明——跟标题段落的 note 一样是纯元数据，不进正文渲染，
      // 只用来在大纲树的"块"行里给一句说明。没有 note 的老卡解析出来是默认
      // 空串，完全向后兼容。
      note: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-card-note') || '',
        renderHTML: (attrs) => (attrs.note ? { 'data-card-note': attrs.note } : {}),
      },
      // 作者自己写的英文，每段一个字符串。null = 没写过。
      // 刻意是纯文本数组而不是 ProseMirror 片段：段落一一对应，所以英文不需要
      // 自带段落样式（章名/标题/列表/引用/注全部按序号从对应的中文段继承）。这个
      // 决定连带消掉了"第二个编辑器 + 派生文档 + 写回桥"的全部复杂度。
      //
      // CRITICAL：en.length === 本卡段落数 是不变量。形状不对一律当"没写过"，
      // 绝不好心补齐或截断——补出来的英文跟中文对不上，比没有更有害。
      // JSON 路径（getJSON/setContent）不走 parseHTML，所以 CardView 读取时还要
      // 再用 isValidEn 兜一层。
      en: {
        default: null,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).getAttribute('data-en')
          if (!raw) return null
          try {
            const parsed = JSON.parse(raw)
            const count = (el as HTMLElement).querySelectorAll('p').length
            return isValidEn(parsed, count) ? parsed : null
          } catch {
            return null
          }
        },
        renderHTML: (attrs) => (attrs.en ? { 'data-en': JSON.stringify(attrs.en) } : {}),
      },
      // 写英文时那一版中文的指纹。空串 = 显式标记为过期（见 enText.STALE_SRC）。
      enSrc: {
        default: UNCONFIRMED,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-en-src') || UNCONFIRMED,
        renderHTML: (attrs) => (attrs.enSrc ? { 'data-en-src': attrs.enSrc } : {}),
      },
      // 最后一次改动英文的时间（ISO string）。纯信息，不参与任何判断。
      enAt: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-en-at') || '',
        renderHTML: (attrs) => (attrs.enAt ? { 'data-en-at': attrs.enAt } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'section[data-card-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { class: 'card' }), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CardView)
  },
  addCommands() {
    return {
      splitCard:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          // 找到 card 所在的深度（card 是 paragraph 的父级）
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'card') {
              cardDepth = d
              break
            }
          }
          if (cardDepth === -1) return false
          if (dispatch) {
            // 下刀之前先算好英文怎么分——split 之后节点结构就变了，算不回来。
            const cardNode = $from.node(cardDepth)
            const paraIndex = $from.index(cardDepth)
            const atBoundary = $from.parentOffset === 0
            const zhBefore = cardParagraphTexts(cardNode)
            const wasConfirmed =
              confirmState(cardNode.attrs.en, cardNode.attrs.enSrc || '', zhBefore.join('\n')) === 'confirmed'
            const plan = splitEn(cardNode.attrs.en, zhBefore, paraIndex, atBoundary, wasConfirmed)
            const now = new Date().toISOString()
            const cardPos = $from.before(cardDepth)

            const tr = state.tr
            if (!state.selection.empty) tr.deleteSelection()
            // 从光标一路 split 到 card 这一层：depth(card) 到 depth(选区) 差几层就 split 几层
            const splitDepth = tr.selection.$from.depth - cardDepth + 1
            tr.split(tr.selection.from, splitDepth)

            // 前半张还在原位
            applyEnState(tr, cardPos, plan.first, now)

            // 清掉新 card 继承来的 cardId，交给 assignCardIds 补新 id；同时落它的英文。
            // CRITICAL：tr.split() 会把 en/enSrc 一并复制给新卡，所以这里必须显式
            // 覆盖——不覆盖就会凭空多出一份重复译文。
            const posAfter = tr.selection.from
            const $pos = tr.doc.resolve(posAfter)
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type.name === 'card') {
                const secondPos = $pos.before(d)
                tr.setNodeAttribute(secondPos, 'cardId', null)
                applyEnState(tr, secondPos, plan.second, now)
                break
              }
            }
            dispatch(tr.scrollIntoView())
          }
          return true
        },
      mergeCardBackward:
        () =>
        ({ state, dispatch }) => {
          const { $from, empty } = state.selection
          if (!empty) return false
          // 必须在 card 的第一个 paragraph 的最前端
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'card') {
              cardDepth = d
              break
            }
          }
          if (cardDepth === -1) return false
          // $from.depth 是光标所在段落的深度；start(depth) 是该段落内容的起点（第一个字符前）
          // index(cardDepth) 是该段落在 card 内的序号，必须是第一个段落
          const atCardStart = $from.pos === $from.start($from.depth) && $from.index(cardDepth) === 0
          if (!atCardStart) return false
          const cardPos = $from.before(cardDepth)
          if (cardPos <= 0) return false // 已是第一个 card
          if (dispatch) {
            // CRITICAL：tr.join() 只保留前一张卡的属性，后一张的英文会被静默吞掉
            // ——作者润色过的东西无声消失。所以合并后必须显式写回拼接的结果。
            const curCard = $from.node(cardDepth)
            const prevCard = state.doc.resolve(cardPos).nodeBefore
            const tr = state.tr
            if (prevCard) {
              const prevPos = cardPos - prevCard.nodeSize
              const prevZh = cardParagraphTexts(prevCard)
              const curZh = cardParagraphTexts(curCard)
              // 只有两边都确认过，合并结果才算确认——绝不替作者盖章。
              const bothConfirmed =
                confirmState(prevCard.attrs.en, prevCard.attrs.enSrc || '', prevZh.join('\n')) === 'confirmed' &&
                confirmState(curCard.attrs.en, curCard.attrs.enSrc || '', curZh.join('\n')) === 'confirmed'
              const merged = mergeEn(prevCard.attrs.en, curCard.attrs.en, [...prevZh, ...curZh], bothConfirmed)
              // join 位置：当前 card 与前一个 card 之间的边界点
              tr.join(cardPos)
              applyEnState(tr, prevPos, merged, new Date().toISOString())
            } else {
              tr.join(cardPos)
            }
            dispatch(tr.scrollIntoView())
          }
          return true
        },
      moveCardUp:
        () =>
        ({ state, dispatch }) => moveCard(state, dispatch, -1),
      moveCardDown:
        () =>
        ({ state, dispatch }) => moveCard(state, dispatch, +1),
      moveCardTo:
        (cardId: string, targetIndex: number) =>
        ({ state, dispatch }) => moveCardToIndex(state, dispatch, cardId, targetIndex),
      moveSection:
        (headingCardIndex: number, targetIndex: number) =>
        ({ state, dispatch }) => moveSectionToIndex(state, dispatch, headingCardIndex, targetIndex),
      insertCardAfter:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'card') {
              cardDepth = d
              break
            }
          }
          if (cardDepth === -1) return false
          if (dispatch) {
            const after = $from.after(cardDepth)
            const card = emptyCardNode(state.schema)
            const tr = state.tr.insert(after, card)
            tr.setSelection(TextSelection.create(tr.doc, after + 2))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
      appendCard:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            const end = state.doc.content.size
            const card = emptyCardNode(state.schema)
            const tr = state.tr.insert(end, card)
            tr.setSelection(TextSelection.create(tr.doc, end + 2))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
      addChapterHeading:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            const end = state.doc.content.size
            const card = emptyChapterCardNode(state.schema)
            const tr = state.tr.insert(end, card)
            tr.setSelection(TextSelection.create(tr.doc, end + 2))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
      setCardColor:
        (color: string | null) =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'card') { cardDepth = d; break }
          if (cardDepth === -1) return false
          if (dispatch) dispatch(state.tr.setNodeAttribute($from.before(cardDepth), 'color', color))
          return true
        },
      setCardNote:
        (cardIndex: number, note: string) =>
        ({ state, dispatch }) => {
          // 定位 doc.content 第 cardIndex 个 card——直接按 doc 顶层 child 序号数，
          // 跟 outlineTreeFromDoc 的 cardIndex 编号规则一致（不依赖光标位置）。
          const doc = state.doc
          if (cardIndex < 0 || cardIndex >= doc.childCount) return false
          let targetPos = -1
          let offset = 0
          for (let i = 0; i < doc.childCount; i++) {
            const child = doc.child(i)
            if (i === cardIndex) {
              targetPos = offset
              break
            }
            offset += child.nodeSize
          }
          if (targetPos === -1) return false
          if (dispatch) dispatch(state.tr.setNodeAttribute(targetPos, 'note', note))
          return true
        },
      removeCard:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'card') { cardDepth = d; break }
          if (cardDepth === -1) return false
          if (state.doc.childCount <= 1) return false
          if (dispatch) {
            const pos = $from.before(cardDepth)
            const node = $from.node(cardDepth)
            dispatch(state.tr.delete(pos, pos + node.nodeSize))
          }
          return true
        },
      insertCardJSONAfter:
        (cardJSON: any, pos: number) =>
        ({ state, dispatch }) => {
          const cardNode = state.doc.nodeAt(pos)
          if (!cardNode || cardNode.type.name !== 'card') return false
          if (dispatch) {
            const node = state.schema.nodeFromJSON({ ...cardJSON, attrs: { ...cardJSON.attrs, cardId: null } })
            const after = pos + cardNode.nodeSize
            const tr = state.tr.insert(after, node)
            tr.setSelection(TextSelection.create(tr.doc, after + 2))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.splitCard(),
      Backspace: () => this.editor.commands.mergeCardBackward(),
      'Mod-ArrowUp': () => this.editor.commands.moveCardUp(),
      'Mod-ArrowDown': () => this.editor.commands.moveCardDown(),
    }
  },
})

export const assignCardIds = Extension.create({
  name: 'assignCardIds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const tr = newState.tr
          let modified = false
          // 先把每张卡当前的底色抄一份下来，边发 id 边更新。同一个 transaction 里
          // 一次生出多张卡（粘贴、搬运、拆卡）时，前面刚定下的色要参与后面那张的
          // 判断——newState.doc 是发 id 之前的快照，光读它看不到本轮分出去的色。
          const colors: (string | null)[] = []
          newState.doc.forEach((node) => colors.push(cardColorOf(node)))
          newState.doc.forEach((node, pos, index) => {
            if (node.type.name !== 'card' || node.attrs.cardId) return
            const banned = new Set([colors[index - 1], colors[index + 1]].filter((c): c is string => !!c))
            const id = pickCardId(banned)
            tr.setNodeAttribute(pos, 'cardId', id)
            colors[index] = node.attrs.color || autoCardColor(id)
            modified = true
          })
          return modified ? tr : null
        },
      }),
    ]
  },
})

// 折叠态的视觉装饰——纯展示层，不碰文档内容（数据安全：卡永远还在 doc 里，
// 只是打个 NODE 装饰 class 让 CSS display:none 掉）。装饰是从 state.doc 现算的
// 派生数据（没有单独 plugin state），每次 doc 变化 ProseMirror 都会重新调用
// decorations()，天然保持与 collapsed 属性同步，不用手动失效。
export const collapseDecorations = Extension.create({
  name: 'collapseDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const hidden = hiddenCardIndices(state.doc)
            state.doc.forEach((node, pos, index) => {
              if (hidden.has(index)) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'card-collapsed-hidden' }))
              }
              // 标题卡自身若 collapsed，加个 data-collapsed 方便画折叠态样式（可选，
              // 跟隐藏正文是两回事：标题卡自己永远不隐藏）。
              if (isCollapsedHeadingCard(node)) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-collapsed': 'true' }))
              }
            })
            return decorations.length ? DecorationSet.create(state.doc, decorations) : null
          },
        },
      }),
    ]
  },
})

export const baseExtensions = [
  CardDocument,
  Card,
  ParagraphWithStyle,
  Text,
  Emphasis,
  Refer,
  Strike,
  assignCardIds,
  collapseDecorations,
  // card 的 content 是 paragraph（非顶层 doc 直接子节点），Placeholder 默认只在 doc 第一层
  // 找 textblock，所以要 includeChildren 才能扫到嵌在 card 里的空 paragraph；
  // showOnlyCurrent: false 让占位不依赖光标是否停在这张卡上。
  Placeholder.configure({
    placeholder: '开始写…',
    emptyNodeClass: 'is-empty',
    includeChildren: true,
    showOnlyCurrent: false,
  }),
  // 撤销/重做（Cmd+Z / Cmd+Shift+Z / Cmd+Y）。TipTap v3 把经典的 History 扩展
  // 换成了 @tiptap/extensions 里的 UndoRedo（同一套 ProseMirror history 插件，
  // 换了个名字）。它记录的是普通 ProseMirror 事务，所以 splitCard/mergeCardBackward/
  // moveCardTo/setParagraphStyle/setCardColor 等自定义命令（全部经 state.tr 派发）
  // 天然一起被记录、一起被撤销，不需要额外接线。
  UndoRedo,
]
