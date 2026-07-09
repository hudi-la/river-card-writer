import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function twoCards() {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
    { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
  ] } })
}

describe('insertCardJSONAfter', () => {
  it('在给定卡位置之后插入 JSON 构造的新卡，新卡在中间、文字来自 JSON、新 cardId 非空且不同于原 id', () => {
    const e = twoCards()
    let pos = -1
    e.state.doc.descendants((n, p) => { if (n.type.name === 'card' && n.attrs.cardId === 'c0') pos = p })
    const cardJSON = { type: 'card', attrs: { cardId: 'from-box', threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '从盒子来的卡' }] }] }
    e.commands.insertCardJSONAfter(cardJSON, pos)

    const cs = e.getJSON().content!
    expect(cs.length).toBe(3)
    expect(cs[0].attrs.cardId).toBe('c0')
    expect(cs[2].attrs.cardId).toBe('c1')
    expect(cs[1].content![0].content![0].text).toBe('从盒子来的卡')
    expect(cs[1].attrs.cardId).toBeTruthy()
    expect(cs[1].attrs.cardId).not.toBe('from-box')
    e.destroy()
  })
})
