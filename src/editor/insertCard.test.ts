import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function twoCards() {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
    { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
  ] } })
}
const ids = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)
function caretIn(e: Editor, cardId: string) {
  let pos = -1
  e.state.doc.descendants((n, p) => { if (n.type.name === 'card' && n.attrs.cardId === cardId) pos = p + 2 })
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)))
}

describe('insertCardAfter / appendCard', () => {
  it('insertCardAfter 在当前卡后插入一张新空卡', () => {
    const e = twoCards(); caretIn(e, 'c0'); e.commands.insertCardAfter()
    const cs = e.getJSON().content!
    expect(cs.length).toBe(3)
    expect(cs[0].attrs.cardId).toBe('c0')
    expect(cs[1].attrs.cardId).toBeTruthy(); expect(cs[1].attrs.cardId).not.toBe('c0'); expect(cs[1].attrs.cardId).not.toBe('c1')
    expect(cs[2].attrs.cardId).toBe('c1')
    expect(cs[1].content![0].type).toBe('paragraph')
    e.destroy()
  })
  it('appendCard 在末尾追加一张空卡', () => {
    const e = twoCards(); e.commands.appendCard()
    const cs = e.getJSON().content!
    expect(cs.length).toBe(3)
    expect(cs[2].attrs.cardId).toBeTruthy()
    expect(ids(e).slice(0, 2)).toEqual(['c0', 'c1'])
    e.destroy()
  })
})
