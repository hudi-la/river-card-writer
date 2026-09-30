import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 在中文正文里把靶心词标出来。没有这一步，边栏和正文就是两张互不相干的表——
// 作者得自己在段落里找"堵"在哪儿。
//
// 走 ProseMirror 装饰器而不是在 CardView 里塞 <mark>：中文正文是 NodeViewContent，
// 由 ProseMirror 管，React 改不了它的内部结构。装饰器是唯一正当的路。

export type TermRange = { from: number; to: number }

// 一段文本里所有靶心词的出现位置。
// 长词优先，且不允许重叠——否则「一爪子按下」和「按下」会互相嵌套，标出来一团糟。
export function findTermRanges(text: string, terms: string[]): TermRange[] {
  const sorted = Array.from(new Set(terms.filter((t) => t.trim() !== ''))).sort(
    (a, b) => b.length - a.length
  )
  const taken: boolean[] = new Array(text.length).fill(false)
  const out: TermRange[] = []

  for (const term of sorted) {
    let i = text.indexOf(term)
    while (i !== -1) {
      let free = true
      for (let k = i; k < i + term.length; k++) {
        if (taken[k]) { free = false; break }
      }
      if (free) {
        for (let k = i; k < i + term.length; k++) taken[k] = true
        out.push({ from: i, to: i + term.length })
      }
      i = text.indexOf(term, i + term.length)
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

export const prepHighlightKey = new PluginKey('prepHighlight')

// 提词变了但文档没变时，装饰器不会自己重算——ProseMirror 只在 doc 变化时重跑。
// 所以 hints 更新后要发一个空事务带上这个 meta，逼它重算一次。
export const PREP_HIGHLIGHT_REFRESH = 'prepHighlightRefresh'

export type PrepHighlightOptions = {
  // 给定 cardId，返回该卡要高亮的中文词。默认返回空数组 = 什么都不标，
  // 所以这个扩展在没接线时完全无害。
  getTerms: (cardId: string) => string[]
}

export const PrepHighlight = Extension.create<PrepHighlightOptions>({
  name: 'prepHighlight',

  addOptions() {
    return { getTerms: () => [] }
  },

  addProseMirrorPlugins() {
    const getTerms = () => this.options.getTerms

    return [
      new Plugin({
        key: prepHighlightKey,
        state: {
          init: (_, state) => build(state.doc, getTerms()),
          apply(tr, old) {
            if (!tr.docChanged && !tr.getMeta(PREP_HIGHLIGHT_REFRESH)) return old.map(tr.mapping, tr.doc)
            return build(tr.doc, getTerms())
          },
        },
        props: {
          decorations(state) {
            return prepHighlightKey.getState(state) as DecorationSet | undefined
          },
        },
      }),
    ]
  },
})

function build(doc: any, getTerms: (cardId: string) => string[]): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== 'card') return true
    const cardId: string | null = node.attrs.cardId
    if (!cardId) return false
    const terms = getTerms(cardId)
    if (terms.length === 0) return false

    // 段落内容的起点 = 卡起点 + 1（进卡）+ 已走过的段落 nodeSize + 1（进段）
    let paraPos = pos + 1
    node.forEach((para: any) => {
      const text = para.textContent
      for (const r of findTermRanges(text, terms)) {
        decos.push(
          Decoration.inline(paraPos + 1 + r.from, paraPos + 1 + r.to, { class: 'prep-hit' })
        )
      }
      paraPos += para.nodeSize
    })
    return false
  })
  return DecorationSet.create(doc, decos)
}

// 某张卡当前有几条靶心。跟装饰器同一个来源（都走 getTerms），所以正文里高亮
// 几处、卡上说几条，不会两边不一致。
export function prepHitCount(editor: { extensionManager?: { extensions: any[] } }, cardId: string): number {
  const ext = editor.extensionManager?.extensions.find((e) => e.name === 'prepHighlight')
  const getTerms = ext?.options?.getTerms as ((id: string) => string[]) | undefined
  return getTerms ? getTerms(cardId).length : 0
}

// ── 光标所在的卡 ────────────────────────────────────────────────
// 给它挂一个 class，样式那边据此画边框。
// 单独一个插件、且不存 state：每次 selection 变化 ProseMirror 都会重新调用
// props.decorations，所以现算比维护一份 plugin state 更简单也更不会失准。
export const ActiveCard = Extension.create({
  name: 'activeCard',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { $from } = state.selection
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'card') {
                const pos = $from.before(d)
                return DecorationSet.create(state.doc, [
                  Decoration.node(pos, pos + $from.node(d).nodeSize, { class: 'is-active-card' }),
                ])
              }
            }
            return null
          },
        },
      }),
    ]
  },
})
