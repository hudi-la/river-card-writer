import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function twoCards() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
      { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二' }] }] },
    ] },
  })
}

describe('mergeCardBackward', () => {
  it('光标在第二个 card 最前端时，两个 card 合并为一个', () => {
    const editor = twoCards()
    // 第二个 card 的段首位置：doc 结构 pos —— 用 resolve 找第二个 card 的起点
    let secondStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'card' && node.attrs.cardId === 'c2') secondStart = pos + 2 // +1 进 card, +1 进 paragraph
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, secondStart)))
    editor.commands.mergeCardBackward()
    const cards = editor.getJSON().content!
    expect(cards.length).toBe(1)
    expect(cards[0].attrs.cardId).toBe('c1')
    // 合并后 card 里有两个 paragraph：第一、第二
    const texts = cards[0].content!.map((p: any) => p.content?.[0]?.text)
    expect(texts).toEqual(['第一', '第二'])
    editor.destroy()
  })

  it('光标不在 card 起点时，命令返回 false（放行默认删除）', () => {
    const editor = twoCards()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)))
    expect(editor.commands.mergeCardBackward()).toBe(false)
    editor.destroy()
  })
})
