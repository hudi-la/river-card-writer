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
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] },
      ],
    },
  })
}

function marksOfFirstTextNode(e: Editor): string[] {
  const textNode = e.getJSON().content![0].content![0].content?.[0]
  return (textNode?.marks ?? []).map((m: any) => m.type)
}

describe('emphasis / refer marks', () => {
  it('toggleEmphasis 给选中文字加上 emphasis mark，再 toggle 去掉', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 7)))
    e.commands.toggleEmphasis()
    expect(marksOfFirstTextNode(e)).toContain('emphasis')
    e.commands.toggleEmphasis()
    expect(marksOfFirstTextNode(e)).not.toContain('emphasis')
    e.destroy()
  })

  it('toggleRefer 给选中文字加上 refer mark，再 toggle 去掉', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 7)))
    e.commands.toggleRefer()
    expect(marksOfFirstTextNode(e)).toContain('refer')
    e.commands.toggleRefer()
    expect(marksOfFirstTextNode(e)).not.toContain('refer')
    e.destroy()
  })

  it('emphasis 和 refer 可以叠加在同一段文字上', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 7)))
    e.commands.toggleEmphasis()
    e.commands.toggleRefer()
    const marks = marksOfFirstTextNode(e)
    expect(marks).toContain('emphasis')
    expect(marks).toContain('refer')
    e.destroy()
  })

  it('toggleStrike 给选中文字加上 strike mark，再 toggle 去掉', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 7)))
    e.commands.toggleStrike()
    expect(marksOfFirstTextNode(e)).toContain('strike')
    e.commands.toggleStrike()
    expect(marksOfFirstTextNode(e)).not.toContain('strike')
    e.destroy()
  })

  it('strike 可以和 emphasis/refer 叠加在同一段文字上', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2, 7)))
    e.commands.toggleEmphasis()
    e.commands.toggleStrike()
    const marks = marksOfFirstTextNode(e)
    expect(marks).toContain('emphasis')
    expect(marks).toContain('strike')
    e.destroy()
  })
})
