import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { zhFingerprint, STALE_SRC } from './enText'

// 第 cardIndex 张卡里第 paraIndex 段内容的起点（parentOffset === 0 的那个位置）。
// 手推位置太容易错，走一遍 doc 算出来。
function posAtParaStart(e: Editor, cardIndex: number, paraIndex: number): number {
  const doc = e.state.doc
  let pos = 0
  for (let i = 0; i < cardIndex; i++) pos += doc.child(i).nodeSize
  const card = doc.child(cardIndex)
  pos += 1 // 进入 card
  for (let i = 0; i < paraIndex; i++) pos += card.child(i).nodeSize
  return pos + 1 // 进入 paragraph 的内容
}

const cards = (e: Editor) => e.getJSON().content!

function twoParaCard() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0', en: ['One.', 'Two.'], enSrc: zhFingerprint(['第一段', '第二段']) },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '第一段' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
          ],
        },
      ],
    },
  })
}

describe('切分时英文跟着走', () => {
  it('在第二段段首下刀：英文按段序号切开，两张卡各自新鲜', () => {
    const e = twoParaCard()
    e.commands.setTextSelection(posAtParaStart(e, 0, 1))
    e.commands.splitCard()

    const c = cards(e)
    expect(c.length).toBe(2)
    expect(c[0].attrs!.en).toEqual(['One.'])
    expect(c[1].attrs!.en).toEqual(['Two.'])
    expect(c[0].attrs!.enSrc).toBe(zhFingerprint(['第一段']))
    expect(c[1].attrs!.enSrc).toBe(zhFingerprint(['第二段']))
    e.destroy()
  })

  it('绝不出现"两张卡各扛一份完整英文"——那是 tr.split() 的默认行为，必须被覆盖', () => {
    const e = twoParaCard()
    e.commands.setTextSelection(posAtParaStart(e, 0, 1))
    e.commands.splitCard()

    const c = cards(e)
    expect(c[0].attrs!.en).not.toEqual(['One.', 'Two.'])
    expect(c[1].attrs!.en).not.toEqual(['One.', 'Two.'])
    e.destroy()
  })

  it('在段落中间下刀：英文留给前半张并标过期，后半张当没写过', () => {
    const e = twoParaCard()
    e.commands.setTextSelection(posAtParaStart(e, 0, 0) + 1) // 「第一段」中间
    e.commands.splitCard()

    const c = cards(e)
    expect(c.length).toBe(2)
    expect(c[0].attrs!.enSrc).toBe(STALE_SRC)
    expect(c[1].attrs!.en).toBe(null)
    e.destroy()
  })

  it('没写过英文的卡切开后两半都还是没写过', () => {
    const e = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [{
          type: 'card', attrs: { cardId: 'c0' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
          ],
        }],
      },
    })
    e.commands.setTextSelection(posAtParaStart(e, 0, 1))
    e.commands.splitCard()
    const c = cards(e)
    expect(c[0].attrs!.en).toBe(null)
    expect(c[1].attrs!.en).toBe(null)
    e.destroy()
  })
})

describe('合并时英文跟着走', () => {
  function twoCards(enA: string[] | null, enB: string[] | null) {
    return new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'a', en: enA, enSrc: enA ? zhFingerprint(['甲']) : STALE_SRC },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }] },
          { type: 'card', attrs: { cardId: 'b', en: enB, enSrc: enB ? zhFingerprint(['乙']) : STALE_SRC },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }] },
        ],
      },
    })
  }

  it('两边都写过：英文拼接，并按合并后的中文重算指纹', () => {
    const e = twoCards(['A.'], ['B.'])
    e.commands.setTextSelection(posAtParaStart(e, 1, 0))
    e.commands.mergeCardBackward()

    const c = cards(e)
    expect(c.length).toBe(1)
    expect(c[0].attrs!.en).toEqual(['A.', 'B.'])
    expect(c[0].attrs!.enSrc).toBe(zhFingerprint(['甲', '乙']))
    e.destroy()
  })

  it('后一张的英文绝不被静默吞掉——那是 tr.join() 的默认行为', () => {
    const e = twoCards(null, ['B.'])
    e.commands.setTextSelection(posAtParaStart(e, 1, 0))
    e.commands.mergeCardBackward()

    const c = cards(e)
    expect(c.length).toBe(1)
    expect(c[0].attrs!.en).toEqual(['B.'])
    expect(c[0].attrs!.enSrc).toBe(STALE_SRC) // 盖不全合并后的中文
    e.destroy()
  })

  it('只有前一张写过：保留它的英文并标过期', () => {
    const e = twoCards(['A.'], null)
    e.commands.setTextSelection(posAtParaStart(e, 1, 0))
    e.commands.mergeCardBackward()

    const c = cards(e)
    expect(c[0].attrs!.en).toEqual(['A.'])
    expect(c[0].attrs!.enSrc).toBe(STALE_SRC)
    e.destroy()
  })

  it('两边都没写过：合并后还是没写过', () => {
    const e = twoCards(null, null)
    e.commands.setTextSelection(posAtParaStart(e, 1, 0))
    e.commands.mergeCardBackward()
    expect(cards(e)[0].attrs!.en).toBe(null)
    e.destroy()
  })
})
