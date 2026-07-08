import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function oneCard() {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
  ] } })
}
describe('setCardThread', () => {
  it('把当前卡的 threadId 设为给定值，再置空', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    e.commands.setCardThread('t1')
    expect(e.getJSON().content![0].attrs.threadId).toBe('t1')
    e.commands.setCardThread(null)
    expect(e.getJSON().content![0].attrs.threadId).toBe(null)
    e.destroy()
  })
})
