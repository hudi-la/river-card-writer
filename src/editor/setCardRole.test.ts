import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function oneCard() {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
  ] } })
}
describe('setCardRole', () => {
  it('把当前卡的 role 设为 heading，再置回 body', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    e.commands.setCardRole('heading')
    expect(e.getJSON().content![0].attrs.role).toBe('heading')
    e.commands.setCardRole('body')
    expect(e.getJSON().content![0].attrs.role).toBe('body')
    e.destroy()
  })
})
