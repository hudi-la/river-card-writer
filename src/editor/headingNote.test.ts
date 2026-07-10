import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { outlineFromDoc } from '../ui/LeftNav'

function twoHeadingsDoc() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第一章' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] },
        { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', attrs: { style: 'h1' }, content: [{ type: 'text', text: '第二章' }] }] },
      ],
    },
  })
}

describe('paragraph note attr', () => {
  it('段落默认 note 是空串', () => {
    const e = twoHeadingsDoc()
    expect(e.getJSON().content![0].content![0].attrs?.note).toBe('')
    e.destroy()
  })

  it('老文档段落（JSON 里没有 note 字段）解析后 note 也是空串', () => {
    const e = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '旧章节' }] }] },
        ],
      },
    })
    expect(e.getJSON().content![0].content![0].attrs?.note).toBe('')
    e.destroy()
  })
})

describe('setHeadingNote command', () => {
  it('设第 1 个（index=1）标题的 note，第 0 个标题保持空', () => {
    const e = twoHeadingsDoc()
    const ok = e.commands.setHeadingNote(1, '第二章的说明')
    expect(ok).toBe(true)

    const json = e.getJSON()
    const firstHeadingParagraph = json.content![0].content![0]
    const secondHeadingParagraph = json.content![2].content![0]
    expect(firstHeadingParagraph.attrs?.note).toBe('')
    expect(secondHeadingParagraph.attrs?.note).toBe('第二章的说明')
    e.destroy()
  })

  it('headingIndex 超界返回 false，不改变文档', () => {
    const e = twoHeadingsDoc()
    const ok = e.commands.setHeadingNote(5, 'x')
    expect(ok).toBe(false)
    e.destroy()
  })

  it('outlineFromDoc 在结果里带上 note', () => {
    const e = twoHeadingsDoc()
    e.commands.setHeadingNote(1, '第二章的说明')
    const outline = outlineFromDoc(e.getJSON())
    expect(outline).toEqual([
      { level: 1, text: '第一章', index: 0, note: '' },
      { level: 2, text: '第二章', index: 1, note: '第二章的说明' },
    ])
    e.destroy()
  })
})
