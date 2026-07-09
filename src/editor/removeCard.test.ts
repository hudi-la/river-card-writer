import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function threeCards() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: ['A', 'B', 'C'].map((t, i) => (
      { type: 'card', attrs: { cardId: 'c' + i }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }
    )) },
  })
}
function oneCard() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
    ] },
  })
}
function caretInCard(editor: Editor, cardId: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => { if (node.type.name === 'card' && node.attrs.cardId === cardId) pos = p + 2 })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}
const order = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)

describe('removeCard', () => {
  it('三张卡，光标在中间卡，removeCard 后剩两张且中间那张没了', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    const ok = editor.commands.removeCard()
    expect(ok).toBe(true)
    expect(order(editor)).toEqual(['c0', 'c2'])
    editor.destroy()
  })

  it('只剩一张时 removeCard 返回 false，仍一张', () => {
    const editor = oneCard()
    caretInCard(editor, 'c0')
    const ok = editor.commands.removeCard()
    expect(ok).toBe(false)
    expect(order(editor)).toEqual(['c0'])
    editor.destroy()
  })
})
