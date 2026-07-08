import { Node, Extension, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EditorState, Plugin, Transaction, TextSelection } from '@tiptap/pm/state'
import { nanoid } from 'nanoid'
import { CardView } from './CardView'

export const CardDocument = Document.extend({ content: 'card+' })

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    card: {
      splitCard: () => ReturnType
      mergeCardBackward: () => ReturnType
      moveCardUp: () => ReturnType
      moveCardDown: () => ReturnType
      insertCardAfter: () => ReturnType
      appendCard: () => ReturnType
    }
  }
}

function emptyCardNode(schema: EditorState['schema']) {
  const paragraph = schema.nodes.paragraph.createAndFill()!
  return schema.nodes.card.create({ cardId: null, threadId: null, role: 'body' }, paragraph)
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
      threadId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-thread-id'),
        renderHTML: (attrs) => (attrs.threadId ? { 'data-thread-id': attrs.threadId } : {}),
      },
      role: {
        default: 'body',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-role') || 'body',
        renderHTML: (attrs) => ({ 'data-role': attrs.role }),
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
    }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.splitCard(),
      Backspace: () => this.editor.commands.mergeCardBackward(),
      'Alt-ArrowUp': () => this.editor.commands.moveCardUp(),
      'Alt-ArrowDown': () => this.editor.commands.moveCardDown(),
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

export const baseExtensions = [CardDocument, Card, Paragraph, Text, assignCardIds]
