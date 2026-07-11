import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function makeEditor(doc?: object) {
  return new Editor({ extensions: baseExtensions, content: doc })
}

describe('card schema', () => {
  it('文档由 card 组成，card 默认 color=null', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] }],
    })
    const json = editor.getJSON()
    expect(json.content?.[0].type).toBe('card')
    expect(json.content?.[0].attrs?.color).toBe(null)
    editor.destroy()
  })

  it('缺 cardId 的 card 会被自动补上唯一 id', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
      ],
    })
    // Initial content load doesn't always run appendTransaction; force one
    // via a setContent round-trip so assignCardIds has a chance to fire.
    editor.commands.setContent(editor.getJSON())
    const ids = editor.getJSON().content!.map((c: any) => c.attrs.cardId)
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])
    editor.destroy()
  })

  function paragraphText(editor: Editor, cardIndex = 0): string {
    const card: any = editor.getJSON().content![cardIndex]
    return card.content?.[0]?.content?.map((t: any) => t.text).join('') ?? ''
  }

  it('undo() 撤销普通输入，redo() 重做', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] }],
    })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('！')
    expect(paragraphText(editor)).toBe('你好！')
    editor.commands.undo()
    expect(paragraphText(editor)).toBe('你好')
    editor.commands.redo()
    expect(paragraphText(editor)).toBe('你好！')
    editor.destroy()
  })

  it('undo() 撤销 splitCard 命令（自定义卡片命令也走同一条历史栈）', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] }],
    })
    expect(editor.getJSON().content?.length).toBe(1)
    editor.commands.setTextSelection(3) // 光标落在"你"和"好"之间
    editor.commands.splitCard()
    expect(editor.getJSON().content?.length).toBe(2)
    editor.commands.undo()
    expect(editor.getJSON().content?.length).toBe(1)
    expect(paragraphText(editor)).toBe('你好')
    editor.commands.redo()
    expect(editor.getJSON().content?.length).toBe(2)
    editor.destroy()
  })
})
