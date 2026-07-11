import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions, hiddenCardIndices, sectionRange } from './schema'

function card(cardId: string, style: string | undefined, text: string, collapsed?: boolean) {
  return {
    type: 'card',
    attrs: { cardId },
    content: [
      {
        type: 'paragraph',
        attrs: { ...(style ? { style } : {}), ...(collapsed !== undefined ? { collapsed } : {}) },
        content: text ? [{ type: 'text', text }] : [],
      },
    ],
  }
}

function docEditor(cards: any[]) {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: cards } })
}

// doc=[章1,卡a,节1.1,卡b,章2,卡c]，跟 moveSection.test.ts 共用的六卡夹具。
function sixCardDoc() {
  return [
    card('chap1', 'chapter', '第一章'),
    card('cardA', undefined, 'a'),
    card('h11', 'h1', '第一节'),
    card('cardB', undefined, 'b'),
    card('chap2', 'chapter', '第二章'),
    card('cardC', undefined, 'c'),
  ]
}

describe('paragraph collapsed attr', () => {
  it('默认 collapsed 是 false', () => {
    const e = docEditor(sixCardDoc())
    expect(e.getJSON().content![0].content![0].attrs?.collapsed).toBe(false)
    e.destroy()
  })

  it('老文档段落（JSON 里没有 collapsed 字段）解析后 collapsed 也是 false', () => {
    const e = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '老章' }] }] },
        ],
      },
    })
    expect(e.getJSON().content![0].content![0].attrs?.collapsed).toBe(false)
    expect(hiddenCardIndices(e.state.doc).size).toBe(0)
    e.destroy()
  })

  it('collapsed 落进 data-collapsed，往返解析不丢', () => {
    const e = docEditor(sixCardDoc())
    e.commands.toggleCollapsed(0)
    const html = e.getHTML()
    expect(html).toContain('data-collapsed="true"')

    const e2 = new Editor({ extensions: baseExtensions, content: html })
    expect(e2.getJSON().content![0].content![0].attrs?.collapsed).toBe(true)
    e.destroy()
    e2.destroy()
  })
})

describe('toggleCollapsed command', () => {
  it('翻转指定 headingCardIndex 的 heading 段落 collapsed', () => {
    const e = docEditor(sixCardDoc())
    const ok = e.commands.toggleCollapsed(0)
    expect(ok).toBe(true)
    expect(e.getJSON().content![0].content![0].attrs?.collapsed).toBe(true)
    // 再翻一次回到 false
    e.commands.toggleCollapsed(0)
    expect(e.getJSON().content![0].content![0].attrs?.collapsed).toBe(false)
    e.destroy()
  })

  it('越界 headingCardIndex 返回 false，不改变文档', () => {
    const e = docEditor(sixCardDoc())
    expect(e.commands.toggleCollapsed(99)).toBe(false)
    expect(e.commands.toggleCollapsed(-1)).toBe(false)
    e.destroy()
  })
})

describe('sectionRange', () => {
  it('章1 的段范围是 [1,4)（卡a、节1.1、卡b），不含章1自己和章2', () => {
    const e = docEditor(sixCardDoc())
    expect(sectionRange(e.state.doc, 0)).toEqual([1, 4])
    e.destroy()
  })

  it('节1.1 的段范围是 [3,4)（只有卡b）', () => {
    const e = docEditor(sixCardDoc())
    expect(sectionRange(e.state.doc, 2)).toEqual([3, 4])
    e.destroy()
  })

  it('非标题卡返回空范围', () => {
    const e = docEditor(sixCardDoc())
    expect(sectionRange(e.state.doc, 1)).toEqual([1, 1])
    e.destroy()
  })
})

describe('hiddenCardIndices', () => {
  it('无 collapsed 标题时为空集（向后兼容）', () => {
    const e = docEditor(sixCardDoc())
    expect(hiddenCardIndices(e.state.doc).size).toBe(0)
    e.destroy()
  })

  it('章1 collapsed → 隐藏卡a(1)、节1.1(2)、卡b(3)，不含章1(0)、章2(4)、卡c(5)', () => {
    const e = docEditor(sixCardDoc())
    e.commands.toggleCollapsed(0)
    expect(hiddenCardIndices(e.state.doc)).toEqual(new Set([1, 2, 3]))
    e.destroy()
  })

  it('只 collapsed 节1.1 → 只隐藏卡b(3)', () => {
    const e = docEditor(sixCardDoc())
    e.commands.toggleCollapsed(2)
    expect(hiddenCardIndices(e.state.doc)).toEqual(new Set([3]))
    e.destroy()
  })
})
