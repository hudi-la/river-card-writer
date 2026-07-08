import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function makeEditor(doc?: object) {
  return new Editor({ extensions: baseExtensions, content: doc })
}

describe('card schema', () => {
  it('文档由 card 组成，card 默认 role=body、threadId=null', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] }],
    })
    const json = editor.getJSON()
    expect(json.content?.[0].type).toBe('card')
    expect(json.content?.[0].attrs?.role).toBe('body')
    expect(json.content?.[0].attrs?.threadId).toBe(null)
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
})
