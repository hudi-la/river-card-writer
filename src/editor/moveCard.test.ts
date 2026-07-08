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
function caretInCard(editor: Editor, cardId: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => { if (node.type.name === 'card' && node.attrs.cardId === cardId) pos = p + 2 })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}
const order = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)

describe('move card', () => {
  it('moveCardDown 把中间的 B 往下换到 C 后面', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    editor.commands.moveCardDown()
    expect(order(editor)).toEqual(['c0', 'c2', 'c1'])
    editor.destroy()
  })
  it('moveCardUp 把 B 往上换到 A 前面', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    editor.commands.moveCardUp()
    expect(order(editor)).toEqual(['c1', 'c0', 'c2'])
    editor.destroy()
  })
  it('第一个 card moveCardUp 无效、顺序不变', () => {
    const editor = threeCards()
    caretInCard(editor, 'c0')
    editor.commands.moveCardUp()
    expect(order(editor)).toEqual(['c0', 'c1', 'c2'])
    editor.destroy()
  })
})
