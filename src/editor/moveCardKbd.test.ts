import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { baseExtensions, Card } from './schema'

function threeCards() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: ['A', 'B', 'C'].map((t, i) => ({
        type: 'card',
        attrs: { cardId: 'c' + i },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
      })),
    },
  })
}

function caretInCard(editor: Editor, cardId: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'card' && node.attrs.cardId === cardId) pos = p + 2
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

const order = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)

describe('Card 键盘绑定', () => {
  it('注册了 Mod-ArrowUp / Mod-ArrowDown（连同保留下来的 Mod-Enter / Backspace）', () => {
    const shortcuts = Card.config.addKeyboardShortcuts!.call({ editor: null } as any)
    expect(typeof shortcuts['Mod-ArrowUp']).toBe('function')
    expect(typeof shortcuts['Mod-ArrowDown']).toBe('function')
    expect(typeof shortcuts['Mod-Enter']).toBe('function')
    expect(typeof shortcuts['Backspace']).toBe('function')
    // Alt-Arrow 键位已经让位给 Mod-Arrow，不应该再注册
    expect(shortcuts['Alt-ArrowUp']).toBeUndefined()
    expect(shortcuts['Alt-ArrowDown']).toBeUndefined()
  })

  it('触发 Mod-ArrowDown 绑定的函数，把光标所在卡换到下一张后面（效果等同 moveCardDown）', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    const shortcuts = Card.config.addKeyboardShortcuts!.call({ editor } as any)
    shortcuts['Mod-ArrowDown']({} as any)
    expect(order(editor)).toEqual(['c0', 'c2', 'c1'])
    editor.destroy()
  })

  it('触发 Mod-ArrowUp 绑定的函数，把光标所在卡换到上一张前面（效果等同 moveCardUp）', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    const shortcuts = Card.config.addKeyboardShortcuts!.call({ editor } as any)
    shortcuts['Mod-ArrowUp']({} as any)
    expect(order(editor)).toEqual(['c1', 'c0', 'c2'])
    editor.destroy()
  })

  it('第一张卡触发 Mod-ArrowUp 无效，顺序不变', () => {
    const editor = threeCards()
    caretInCard(editor, 'c0')
    const shortcuts = Card.config.addKeyboardShortcuts!.call({ editor } as any)
    shortcuts['Mod-ArrowUp']({} as any)
    expect(order(editor)).toEqual(['c0', 'c1', 'c2'])
    editor.destroy()
  })
})
