import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function threeCards() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: ['A', 'B', 'C'].map((t, i) => (
      { type: 'card', attrs: { cardId: 'c' + i }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }
    )) },
  })
}
const order = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)

describe('moveCardTo', () => {
  it('[A,B,C]，把 A 挪到 index 2 → [B,C,A]', () => {
    const editor = threeCards()
    editor.commands.moveCardTo('c0', 2)
    expect(order(editor)).toEqual(['c1', 'c2', 'c0'])
    editor.destroy()
  })

  it('[A,B,C]，把 C 挪到 A 前面（index 0）→ [C,A,B]', () => {
    const editor = threeCards()
    editor.commands.moveCardTo('c2', 0)
    expect(order(editor)).toEqual(['c2', 'c0', 'c1'])
    editor.destroy()
  })

  it('落回原位是 no-op：[A,B,C]，把 B 挪到 index 1（自己的位置）→ 顺序不变', () => {
    const editor = threeCards()
    editor.commands.moveCardTo('c1', 1)
    expect(order(editor)).toEqual(['c0', 'c1', 'c2'])
    editor.destroy()
  })

  it('未知 cardId 返回 false，顺序不变', () => {
    const editor = threeCards()
    const ok = editor.commands.moveCardTo('nope', 1)
    expect(ok).toBe(false)
    expect(order(editor)).toEqual(['c0', 'c1', 'c2'])
    editor.destroy()
  })
})
