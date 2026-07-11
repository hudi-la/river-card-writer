import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function threeCardsDoc() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一块' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二块' }] }] },
        { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第三块' }] }] },
      ],
    },
  })
}

describe('card note attr', () => {
  it('card 默认 note 是空串', () => {
    const e = threeCardsDoc()
    expect(e.getJSON().content![0].attrs?.note).toBe('')
    e.destroy()
  })

  it('老文档 card（JSON 里没有 note 字段）解析后 note 也是空串', () => {
    const e = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '老卡' }] }] },
        ],
      },
    })
    expect(e.getJSON().content![0].attrs?.note).toBe('')
    e.destroy()
  })
})

describe('setCardNote command', () => {
  it('设第 1 个（cardIndex=1）card 的 note，其它 card 保持空', () => {
    const e = threeCardsDoc()
    const ok = e.commands.setCardNote(1, '块说明')
    expect(ok).toBe(true)

    const json = e.getJSON()
    expect(json.content![0].attrs?.note).toBe('')
    expect(json.content![1].attrs?.note).toBe('块说明')
    expect(json.content![2].attrs?.note).toBe('')
    e.destroy()
  })

  it('cardIndex 超界返回 false，不改变文档', () => {
    const e = threeCardsDoc()
    const ok = e.commands.setCardNote(5, 'x')
    expect(ok).toBe(false)
    e.destroy()
  })

  it('note 落进 data-card-note，往返解析不丢', () => {
    const e = threeCardsDoc()
    e.commands.setCardNote(0, '往返测试')
    const html = e.getHTML()
    expect(html).toContain('data-card-note="往返测试"')

    const e2 = new Editor({ extensions: baseExtensions, content: html })
    expect(e2.getJSON().content![0].attrs?.note).toBe('往返测试')
    e.destroy()
    e2.destroy()
  })
})
