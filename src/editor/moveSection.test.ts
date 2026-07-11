import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function card(cardId: string, style: string | undefined, text: string) {
  return {
    type: 'card',
    attrs: { cardId },
    content: [{ type: 'paragraph', attrs: style ? { style } : undefined, content: text ? [{ type: 'text', text }] : [] }],
  }
}

function docEditor(cards: any[]) {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: cards } })
}

const order = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)

// doc=[章1,卡a,节1.1,卡b,章2,卡c]，贯穿本文件多个用例复用。
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

describe('moveSection', () => {
  it('把章2（整段=自己+卡c）搬到最前 → [章2,卡c,章1,卡a,节1.1,卡b]', () => {
    const editor = docEditor(sixCardDoc())
    const ok = editor.commands.moveSection(4, 0)
    expect(ok).toBe(true)
    expect(order(editor)).toEqual(['chap2', 'cardC', 'chap1', 'cardA', 'h11', 'cardB'])
    editor.destroy()
  })

  it('移动带子节的章：章1 整段（自己+卡a+节1.1+卡b）一起搬到末尾', () => {
    const editor = docEditor(sixCardDoc())
    const ok = editor.commands.moveSection(0, 6)
    expect(ok).toBe(true)
    // 章1 整段搬到章2 之后——结果跟"把章2 搬到最前"殊途同归，都是两段互换。
    expect(order(editor)).toEqual(['chap2', 'cardC', 'chap1', 'cardA', 'h11', 'cardB'])
    editor.destroy()
  })

  it('移动一个节：只带走它自己的块，直到下一个节/章为止，不带上层章的其它内容', () => {
    const editor = docEditor([
      card('chap1', 'chapter', '第一章'),
      card('h11', 'h1', '节一'),
      card('cardA', undefined, 'a'),
      card('h12', 'h1', '节二'),
      card('cardB', undefined, 'b'),
    ])
    const ok = editor.commands.moveSection(1, 5)
    expect(ok).toBe(true)
    expect(order(editor)).toEqual(['chap1', 'h12', 'cardB', 'h11', 'cardA'])
    editor.destroy()
  })

  it('把节挪到本章最前面（目标下标落在章标题之后）', () => {
    const editor = docEditor(sixCardDoc())
    // 节1.1（index2）搬到 index1（卡a 前面）
    const ok = editor.commands.moveSection(2, 1)
    expect(ok).toBe(true)
    expect(order(editor)).toEqual(['chap1', 'h11', 'cardB', 'cardA', 'chap2', 'cardC'])
    editor.destroy()
  })

  it('落回原位是 no-op', () => {
    const editor = docEditor(sixCardDoc().slice(0, 3))
    const ok = editor.commands.moveSection(0, 0)
    expect(ok).toBe(true)
    expect(order(editor)).toEqual(['chap1', 'cardA', 'h11'])
    editor.destroy()
  })

  it('对非标题卡（block）调用 moveSection 返回 false，doc 不变', () => {
    const editor = docEditor([card('chap1', 'chapter', '第一章'), card('cardA', undefined, 'a')])
    const ok = editor.commands.moveSection(1, 0)
    expect(ok).toBe(false)
    expect(order(editor)).toEqual(['chap1', 'cardA'])
    editor.destroy()
  })

  it('越界 headingCardIndex 返回 false', () => {
    const editor = docEditor(sixCardDoc())
    expect(editor.commands.moveSection(99, 0)).toBe(false)
    expect(editor.commands.moveSection(-1, 0)).toBe(false)
    expect(order(editor)).toEqual(['chap1', 'cardA', 'h11', 'cardB', 'chap2', 'cardC'])
    editor.destroy()
  })

  it('数据安全：搬动前后卡片总数不变，每张卡都还在（不丢不重复）', () => {
    const editor = docEditor(sixCardDoc())
    const before = order(editor).slice().sort()
    editor.commands.moveSection(0, 6)
    const after = order(editor).slice().sort()
    expect(after).toEqual(before)
    expect(after.length).toBe(6)
    editor.destroy()
  })

  it('块单移仍走既有的 moveCardTo，不受 moveSection 改动影响', () => {
    const editor = docEditor([
      card('chap1', 'chapter', '第一章'),
      card('cardA', undefined, 'a'),
      card('cardB', undefined, 'b'),
    ])
    editor.commands.moveCardTo('cardB', 0)
    expect(order(editor)).toEqual(['cardB', 'chap1', 'cardA'])
    editor.destroy()
  })
})
