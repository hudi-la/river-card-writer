import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { outlineFromDoc } from '../ui/LeftNav'

function emptyDoc() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [] }] }] },
  })
}

describe('addChapterHeading command', () => {
  it('在文档末尾追加一张卡，其段落 style 为 chapter', () => {
    const e = emptyDoc()
    const ok = e.commands.addChapterHeading()
    expect(ok).toBe(true)

    const cs = e.getJSON().content!
    expect(cs.length).toBe(2)
    const lastCard = cs[cs.length - 1]
    expect(lastCard.content![0].type).toBe('paragraph')
    expect(lastCard.content![0].attrs?.style).toBe('chapter')
    e.destroy()
  })

  it('结合 outlineFromDoc，大纲会多出一条章节 entry', () => {
    const e = emptyDoc()
    expect(outlineFromDoc(e.getJSON())).toEqual([])
    e.commands.addChapterHeading()
    const outline = outlineFromDoc(e.getJSON())
    expect(outline.length).toBe(1)
    expect(outline[0]).toEqual({ level: 1, text: '', index: 0, note: '' })
    e.destroy()
  })

  it('新卡的段落是空文本，光标落在其中，可以立刻打字', () => {
    const e = emptyDoc()
    e.commands.addChapterHeading()
    e.commands.insertContent('新章节标题')
    const outline = outlineFromDoc(e.getJSON())
    expect(outline[0].text).toBe('新章节标题')
    e.destroy()
  })
})
