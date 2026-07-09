import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { baseExtensions } from './schema'

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

function twoParagraphCard() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0' },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
          ],
        },
      ],
    },
  })
}

describe('paragraph style attr', () => {
  it('段落默认 style 是 body', () => {
    const e = oneCard()
    expect(e.getJSON().content![0].content![0].attrs?.style).toBe('body')
    e.destroy()
  })

  it('光标在一段，setParagraphStyle("chapter") 后该段 style 变为 chapter，再设回 body', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    e.commands.setParagraphStyle('chapter')
    expect(e.getJSON().content![0].content![0].attrs?.style).toBe('chapter')
    e.commands.setParagraphStyle('body')
    expect(e.getJSON().content![0].content![0].attrs?.style).toBe('body')
    e.destroy()
  })

  it('选区跨多段时，两段都被设置', () => {
    const e = twoParagraphCard()
    // 选区横跨两个段落
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 12)))
    e.commands.setParagraphStyle('h1')
    const paras = e.getJSON().content![0].content!
    expect(paras[0].attrs?.style).toBe('h1')
    expect(paras[1].attrs?.style).toBe('h1')
    e.destroy()
  })
})
