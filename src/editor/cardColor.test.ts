import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { baseExtensions, autoCardColor, pickCardId, CARD_PALETTE } from './schema'

function oneCard() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
      ],
    },
  })
}

describe('setCardColor', () => {
  it('把光标所在 card 的 color 设为给定值，再清空', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    e.commands.setCardColor('#d98b7a')
    expect(e.getJSON().content![0].attrs.color).toBe('#d98b7a')
    e.commands.setCardColor(null)
    expect(e.getJSON().content![0].attrs.color).toBe(null)
    e.destroy()
  })

  it('card 默认 color 是 null', () => {
    const e = oneCard()
    expect(e.getJSON().content![0].attrs.color).toBe(null)
    e.destroy()
  })
})

describe('autoCardColor', () => {
  it('稳定返回调色板里的某个 hex', () => {
    expect(autoCardColor('abc')).toBe(autoCardColor('abc'))
    expect(CARD_PALETTE).toContain(autoCardColor('abc'))
  })

  it('不同 id 多半返回不同颜色', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const colors = new Set(ids.map(autoCardColor))
    expect(colors.size).toBeGreaterThan(1)
  })
})

// ── 新卡出生时避开相邻卡的颜色 ───────────────────────────────────────────
// 规则只在"出生"那一刻生效：卡拿到 cardId 时看一眼左右邻居，重掷到不撞色为止。
// 之后这张卡被拖到哪儿都不再重算（颜色 = cardId 的纯函数，是这张卡的身份）。

// 一张卡当前渲染出来的底色——跟 CardView / LeftNav 完全同一条公式。
const resolvedColor = (card: any): string => card.attrs.color || autoCardColor(card.attrs.cardId)
const colorsOf = (e: Editor): string[] => e.getJSON().content!.map(resolvedColor)

// 造一张 cardId 为空的新卡节点——模拟 insertCardAfter/splitCard 等命令留给
// assignCardIds 去补 id 的那种"刚出生、还没有身份"的卡。
function newbornCard(e: Editor) {
  const { schema } = e.state
  return schema.nodes.card.create({ cardId: null, color: null }, schema.nodes.paragraph.createAndFill()!)
}

// 两张相邻的卡，颜色由调用方指定（手动设色），中间/两头留给新卡插。
function cardsColored(...colors: string[]) {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: colors.map((color, i) => ({
        type: 'card',
        attrs: { cardId: `c${i}`, color },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `T${i}` }] }],
      })),
    },
  })
}

describe('pickCardId', () => {
  it('跳过颜色落在 banned 里的候选 id，返回第一个不撞色的', () => {
    const banned = new Set([autoCardColor('bad1'), autoCardColor('bad2')])
    const queue = ['bad1', 'bad2', 'good']
    const id = pickCardId(banned, () => queue.shift()!)
    expect(id).toBe('good')
    expect(banned.has(autoCardColor(id))).toBe(false)
  })

  it('banned 覆盖整个调色板时放弃重掷，返回最后一次抽到的 id（不死循环）', () => {
    let draws = 0
    const id = pickCardId(new Set(CARD_PALETTE), () => `x${draws++}`)
    expect(id).toBe(`x${draws - 1}`)
    expect(draws).toBeLessThan(1000)
  })
})

describe('新卡出生时的颜色', () => {
  // 新卡的 id 是随机的，单跑一次本来就有 5/6 概率碰巧不撞色——那样的断言证明不了
  // 任何事。所以每个位置都重复 REPEATS 次：没这条规则的话必然有一次撞上。
  const REPEATS = 40

  it('插在两张卡中间时，跟上下两张都不同色', () => {
    for (let i = 0; i < REPEATS; i++) {
      const e = cardsColored('#7fa3c4', '#d98b7a')
      e.view.dispatch(e.state.tr.insert(e.state.doc.child(0).nodeSize, newbornCard(e)))
      const [above, born, below] = colorsOf(e)
      expect(born).not.toBe(above)
      expect(born).not.toBe(below)
      e.destroy()
    }
  })

  it('追加到末尾时，跟上一张不同色', () => {
    for (let i = 0; i < REPEATS; i++) {
      const e = cardsColored('#7fa3c4', '#d98b7a')
      e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, newbornCard(e)))
      const cs = colorsOf(e)
      expect(cs[2]).not.toBe(cs[1])
      e.destroy()
    }
  })

  it('插到最前面时，跟下一张不同色', () => {
    for (let i = 0; i < REPEATS; i++) {
      const e = cardsColored('#7fa3c4', '#d98b7a')
      e.view.dispatch(e.state.tr.insert(0, newbornCard(e)))
      const cs = colorsOf(e)
      expect(cs[0]).not.toBe(cs[1])
      e.destroy()
    }
  })

  it('邻居没手动设色时，比的是它哈希出来的默认色', () => {
    for (let i = 0; i < REPEATS; i++) {
      const e = new Editor({
        extensions: baseExtensions,
        content: {
          type: 'doc',
          content: [{ type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }],
        },
      })
      e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, newbornCard(e)))
      const cs = colorsOf(e)
      expect(cs[0]).toBe(autoCardColor('c0'))
      expect(cs[1]).not.toBe(cs[0])
      e.destroy()
    }
  })

  it('同一个 transaction 里一次生出多张卡，相邻两两都不同色', () => {
    const e = cardsColored('#7fa3c4')
    const tr = e.state.tr
    const end = e.state.doc.content.size
    tr.insert(end, newbornCard(e))
    tr.insert(tr.doc.content.size, newbornCard(e))
    tr.insert(tr.doc.content.size, newbornCard(e))
    e.view.dispatch(tr)
    const cs = colorsOf(e)
    expect(cs.length).toBe(4)
    for (let i = 1; i < cs.length; i++) expect(cs[i]).not.toBe(cs[i - 1])
    e.destroy()
  })

  it('连着插很多张也一路不撞色', () => {
    const e = cardsColored('#7fa3c4')
    for (let i = 0; i < 60; i++) e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, newbornCard(e)))
    const cs = colorsOf(e)
    expect(cs.length).toBe(61)
    for (let i = 1; i < cs.length; i++) expect(cs[i]).not.toBe(cs[i - 1])
    e.destroy()
  })
})
