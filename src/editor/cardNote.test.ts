import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { resolveCardRow } from './RiverEditor'

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

// 正文点把手弹出的"预览+说明"小框，用 resolveCardRow 从 doc+cardId 解析该卡信息 +
// note 保存路由（标题卡→setHeadingNote 按 headingIndex，普通卡→setCardNote 按 cardIndex）。
describe('resolveCardRow（正文把手说明框的解析/路由）', () => {
  const mkCard = (cardId: string, o: { style?: string; text?: string; note?: string; cardNote?: string } = {}) => {
    const para: any = { type: 'paragraph', content: o.text ? [{ type: 'text', text: o.text }] : [] }
    if (o.style) para.attrs = { style: o.style, note: o.note || '' }
    return { type: 'card', attrs: { cardId, note: o.cardNote || '' }, content: [para] }
  }
  const doc = {
    type: 'doc',
    content: [
      mkCard('h0', { style: 'chapter', text: '第一章', note: '本章说明' }),
      mkCard('b1', { text: '正文一', cardNote: '卡片说明' }),
      mkCard('h2', { style: 'h1', text: '小节' }),
      mkCard('b3', { text: '正文二' }),
    ],
  }

  it('标题卡：kind=heading，note 取标题段落 note，headingIndex 按标题卡序号', () => {
    expect(resolveCardRow(doc, 'h0')).toEqual({ kind: 'heading', cardIndex: 0, headingIndex: 0, note: '本章说明', preview: '第一章' })
    expect(resolveCardRow(doc, 'h2')).toEqual({ kind: 'heading', cardIndex: 2, headingIndex: 1, note: '', preview: '小节' })
  })

  it('普通卡：kind=block，note 取 card.attrs.note，headingIndex=-1，走 cardIndex', () => {
    expect(resolveCardRow(doc, 'b1')).toEqual({ kind: 'block', cardIndex: 1, headingIndex: -1, note: '卡片说明', preview: '正文一' })
    expect(resolveCardRow(doc, 'b3')).toEqual({ kind: 'block', cardIndex: 3, headingIndex: -1, note: '', preview: '正文二' })
  })

  it('找不到 cardId → null', () => {
    expect(resolveCardRow(doc, 'nope')).toBeNull()
  })
})
