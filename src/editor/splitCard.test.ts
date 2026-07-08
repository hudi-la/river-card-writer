import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function editorWithCaretAfter(text: string, caretAfterChars: number) {
  const editor = new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    ] },
  })
  // 放光标：doc(0) > card(1) > paragraph(2) 起点是 pos 2，向后 caretAfterChars
  const pos = 2 + caretAfterChars
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
  return editor
}

describe('splitCard', () => {
  it('把一个 card 从光标处拆成两个 card，文字各归一半', () => {
    const editor = editorWithCaretAfter('前半后半', 2) // 光标在"前半|后半"
    editor.commands.splitCard()
    const cards = editor.getJSON().content!
    expect(cards.length).toBe(2)
    const t = (c: any) => c.content[0].content?.[0]?.text
    expect(t(cards[0])).toBe('前半')
    expect(t(cards[1])).toBe('后半')
    expect(cards[0].attrs.cardId).toBe('c1')
    expect(cards[1].attrs.cardId).toBeTruthy()
    expect(cards[1].attrs.cardId).not.toBe('c1')
    editor.destroy()
  })
})
