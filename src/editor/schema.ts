import { Node, Extension, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Placeholder from '@tiptap/extension-placeholder'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EditorState, Plugin, Transaction, TextSelection } from '@tiptap/pm/state'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { nanoid } from 'nanoid'
import { CardView } from './CardView'
import { Emphasis, Refer } from './marks'

export const CardDocument = Document.extend({ content: 'card+' })

// 段落样式：'body'（正文，默认）/'chapter'（章名）/'h1'/'h2'（层级标题）。
// 渲染成 data-style，样式表按这个属性走视觉区分。
export type ParagraphStyle = 'body' | 'chapter' | 'h1' | 'h2'

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
    }
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

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphStyle: {
      setParagraphStyle: (style: ParagraphStyle) => ReturnType
      setHeadingNote: (headingIndex: number, note: string) => ReturnType
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
  let endIndex = doc.childCount
  for (let i = startIndex + 1; i < doc.childCount; i++) {
    const l = cardHeadingLevel(doc.child(i))
    if (l !== null && l <= level) {
      endIndex = i
      break
    }
  }
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
            const tr = state.tr
            if (!state.selection.empty) tr.deleteSelection()
            // 从光标一路 split 到 card 这一层：depth(card) 到 depth(选区) 差几层就 split 几层
            const splitDepth = tr.selection.$from.depth - cardDepth + 1
            tr.split(tr.selection.from, splitDepth)
            // 清掉新 card 继承来的 cardId，交给 assignCardIds 补新 id
            const posAfter = tr.selection.from
            const $pos = tr.doc.resolve(posAfter)
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type.name === 'card') {
                tr.setNodeAttribute($pos.before(d), 'cardId', null)
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
            // join 位置：当前 card 与前一个 card 之间的边界点
            dispatch(state.tr.join(cardPos).scrollIntoView())
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
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'card' && !node.attrs.cardId) {
              tr.setNodeAttribute(pos, 'cardId', nanoid())
              modified = true
            }
          })
          return modified ? tr : null
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
  assignCardIds,
  // card 的 content 是 paragraph（非顶层 doc 直接子节点），Placeholder 默认只在 doc 第一层
  // 找 textblock，所以要 includeChildren 才能扫到嵌在 card 里的空 paragraph；
  // showOnlyCurrent: false 让占位不依赖光标是否停在这张卡上。
  Placeholder.configure({
    placeholder: '开始写…',
    emptyNodeClass: 'is-empty',
    includeChildren: true,
    showOnlyCurrent: false,
  }),
]
