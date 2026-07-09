import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { baseExtensions, autoCardColor, CARD_PALETTE } from './schema'

function oneCard() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
      ],
    },
  })
}

describe('setCardColor', () => {
  it('把光标所在 card 的 color 设为给定值，再清空', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    e.commands.setCardColor('#d98b7a')
    expect(e.getJSON().content![0].attrs.color).toBe('#d98b7a')
    e.commands.setCardColor(null)
    expect(e.getJSON().content![0].attrs.color).toBe(null)
    e.destroy()
  })

  it('card 默认 color 是 null', () => {
    const e = oneCard()
    expect(e.getJSON().content![0].attrs.color).toBe(null)
    e.destroy()
  })
})

describe('autoCardColor', () => {
  it('稳定返回调色板里的某个 hex', () => {
    expect(autoCardColor('abc')).toBe(autoCardColor('abc'))
    expect(CARD_PALETTE).toContain(autoCardColor('abc'))
  })

  it('不同 id 多半返回不同颜色', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const colors = new Set(ids.map(autoCardColor))
    expect(colors.size).toBeGreaterThan(1)
  })
})
