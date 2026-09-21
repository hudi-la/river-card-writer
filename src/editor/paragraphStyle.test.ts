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

// ── 列表 / 引用 / 注：三种"块样式"，跟章/节一样是段落的 style 属性 ─────────────

function cardWith(...paras: Array<{ style?: string; text?: string }>) {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0' },
          content: paras.map(({ style = 'body', text }) => ({
            type: 'paragraph',
            attrs: { style },
            content: text ? [{ type: 'text', text }] : [],
          })),
        },
      ],
    },
  })
}
const stylesOf = (e: Editor) => e.getJSON().content![0].content!.map((p: any) => p.attrs?.style)
const textsOf = (e: Editor) => e.getJSON().content![0].content!.map((p: any) => p.content?.[0]?.text ?? '')
const cursorAt = (e: Editor, pos: number) => e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)))
// 模拟真实按键：走 ProseMirror 的 handleKeyDown，快捷键才会按优先级依次尝试。
function press(e: Editor, key: string) {
  const event = new KeyboardEvent('keydown', { key })
  e.view.someProp('handleKeyDown', (f) => f(e.view, event))
}
function type(e: Editor, text: string) {
  const { from, to } = e.state.selection
  const handled = e.view.someProp('handleTextInput', (f) => f(e.view, from, to, text, () => e.state.tr.insertText(text, from, to)))
  if (!handled) e.view.dispatch(e.state.tr.insertText(text, from, to))
}

describe('块样式：列表 / 引用 / 注', () => {
  it.each(['bullet', 'quote', 'note'] as const)('setParagraphStyle(%s) 落成 data-style', (style) => {
    const e = cardWith({ text: 'A' })
    cursorAt(e, 2)
    e.commands.setParagraphStyle(style)
    expect(stylesOf(e)).toEqual([style])
    expect(e.getHTML()).toContain(`data-style="${style}"`)
    e.destroy()
  })

  it('HTML 往返保住块样式', () => {
    const e = cardWith({ style: 'quote', text: 'Q' })
    const html = e.getHTML()
    e.commands.setContent(html)
    expect(stylesOf(e)).toEqual(['quote'])
    e.destroy()
  })

  it('toggleParagraphStyle：同一个样式再点一次回到正文', () => {
    const e = cardWith({ text: 'A' })
    cursorAt(e, 2)
    e.commands.toggleParagraphStyle('bullet')
    expect(stylesOf(e)).toEqual(['bullet'])
    e.commands.toggleParagraphStyle('bullet')
    expect(stylesOf(e)).toEqual(['body'])
    e.destroy()
  })

  it('列表项里回车，新段落仍是列表项', () => {
    const e = cardWith({ style: 'bullet', text: 'one' })
    cursorAt(e, 5) // "one" 末尾
    press(e, 'Enter')
    expect(stylesOf(e)).toEqual(['bullet', 'bullet'])
    e.destroy()
  })

  it.each(['bullet', 'quote', 'note'] as const)('空的 %s 段落里回车 → 退回正文，不再多生一段', (style) => {
    const e = cardWith({ style: 'bullet', text: 'one' }, { style })
    cursorAt(e, 7) // 第二段（空）里
    press(e, 'Enter')
    expect(stylesOf(e)).toEqual(['bullet', 'body'])
    e.destroy()
  })

  it('块样式段落开头退格 → 先退回正文，文字不动、不合卡', () => {
    const e = cardWith({ style: 'bullet', text: 'one' })
    cursorAt(e, 2) // 卡里第一段的最前端（mergeCardBackward 也会想抢这个位置）
    press(e, 'Backspace')
    expect(stylesOf(e)).toEqual(['body'])
    expect(textsOf(e)).toEqual(['one'])
    e.destroy()
  })

  it('标题段落开头退格不受影响：照常跟上一段合并，而不是先被改成正文', () => {
    const e = cardWith({ text: 'x' }, { style: 'h1', text: 'H' })
    cursorAt(e, 5) // 第二段开头
    press(e, 'Backspace')
    expect(textsOf(e)).toEqual(['xH'])
    e.destroy()
  })

  it.each([
    ['- ', 'bullet'],
    ['* ', 'bullet'],
    ['> ', 'quote'],
    ['》 ', 'quote'],
  ])('正文段首敲 "%s" → 变成 %s，标记字符被吃掉', (marker, style) => {
    const e = cardWith({})
    cursorAt(e, 2)
    for (const ch of marker) type(e, ch)
    expect(stylesOf(e)).toEqual([style])
    expect(textsOf(e)).toEqual([''])
    e.destroy()
  })

  it('段中间敲 "- " 不触发', () => {
    const e = cardWith({ text: 'ab' })
    cursorAt(e, 4)
    type(e, '-')
    type(e, ' ')
    expect(stylesOf(e)).toEqual(['body'])
    expect(textsOf(e)).toEqual(['ab- '])
    e.destroy()
  })
})
