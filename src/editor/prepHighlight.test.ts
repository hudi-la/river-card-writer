import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { ActiveCard, findTermRanges, PrepHighlight, PREP_HIGHLIGHT_REFRESH } from './prepHighlight'
import { baseExtensions } from './schema'

describe('findTermRanges', () => {
  it('找出一个词的所有出现位置', () => {
    expect(findTermRanges('猫在巡逻，还在巡逻', ['巡逻'])).toEqual([
      { from: 2, to: 4 },
      { from: 7, to: 9 },
    ])
  })

  it('长词优先，不允许重叠——否则「一爪子按下」和「按下」会互相嵌套', () => {
    const r = findTermRanges('就一爪子按下', ['按下', '一爪子按下'])
    expect(r).toEqual([{ from: 1, to: 6 }])
  })

  it('多个不重叠的词按位置排序返回', () => {
    const r = findTermRanges('昂首挺胸在门口巡逻', ['巡逻', '昂首挺胸'])
    expect(r).toEqual([
      { from: 0, to: 4 },
      { from: 7, to: 9 },
    ])
  })

  it('文本里没有的词不产生范围', () => {
    expect(findTermRanges('猫睡着了', ['巡逻'])).toEqual([])
  })

  it('空词和重复词被忽略，不会产生零宽或重复范围', () => {
    expect(findTermRanges('猫在巡逻', ['', '  ', '巡逻', '巡逻'])).toEqual([{ from: 2, to: 4 }])
  })

  it('没有靶心时返回空', () => {
    expect(findTermRanges('猫在巡逻', [])).toEqual([])
  })
})

describe('PrepHighlight 扩展', () => {
  function editorWith(terms: Record<string, string[]>) {
    return new Editor({
      extensions: [...baseExtensions, PrepHighlight.configure({ getTerms: (id) => terms[id] ?? [] })],
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'c0' }, content: [
            { type: 'paragraph', content: [{ type: 'text', text: '昂首挺胸在门口巡逻' }] },
          ] },
          { type: 'card', attrs: { cardId: 'c1' }, content: [
            { type: 'paragraph', content: [{ type: 'text', text: '就一爪子按下' }] },
          ] },
        ],
      },
    })
  }

  const hits = (e: Editor) => e.view.dom.querySelectorAll('.prep-hit')

  it('把该卡的靶心词标成 .prep-hit', () => {
    const e = editorWith({ c0: ['巡逻', '昂首挺胸'] })
    expect(hits(e).length).toBe(2)
    expect(Array.from(hits(e)).map((n) => n.textContent)).toEqual(['昂首挺胸', '巡逻'])
    e.destroy()
  })

  it('只标该卡自己的词，不会标到别的卡上', () => {
    const e = editorWith({ c0: ['一爪子按下'] })
    // 「一爪子按下」在 c1 里，但只给 c0 配了这个词
    expect(hits(e).length).toBe(0)
    e.destroy()
  })

  it('没有任何提词时一个装饰都不加——扩展在没接线时完全无害', () => {
    const e = new Editor({
      extensions: [...baseExtensions, PrepHighlight],
      content: { type: 'doc', content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '巡逻' }] }] },
      ] },
    })
    expect(e.view.dom.querySelectorAll('.prep-hit').length).toBe(0)
    e.destroy()
  })

  it('提词变了、文档没变时，发一个 refresh meta 就能重算', () => {
    const terms: Record<string, string[]> = { c0: [] }
    const e = new Editor({
      extensions: [...baseExtensions, PrepHighlight.configure({ getTerms: (id) => terms[id] ?? [] })],
      content: { type: 'doc', content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '在门口巡逻' }] }] },
      ] },
    })
    expect(e.view.dom.querySelectorAll('.prep-hit').length).toBe(0)

    terms.c0 = ['巡逻']
    e.view.dispatch(e.state.tr.setMeta(PREP_HIGHLIGHT_REFRESH, true))
    expect(e.view.dom.querySelectorAll('.prep-hit').length).toBe(1)
    e.destroy()
  })

  it('改中文后高亮跟着位置走，不会错位', () => {
    const e = editorWith({ c0: ['巡逻'] })
    // 在段首插入两个字，高亮该整体后移
    e.commands.insertContentAt(2, '小猫')
    const hit = e.view.dom.querySelector('.prep-hit')
    expect(hit?.textContent).toBe('巡逻')
    e.destroy()
  })
})

describe('ActiveCard', () => {
  function threeCards() {
    return new Editor({
      extensions: [...baseExtensions, ActiveCard],
      content: {
        type: 'doc',
        content: ['a', 'b', 'c'].map((id) => ({
          type: 'card', attrs: { cardId: id },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `第${id}段` }] }],
        })),
      },
    })
  }

  it('只有光标所在那张卡带 is-active-card', () => {
    const e = threeCards()
    e.commands.setTextSelection(2) // 第一张卡里
    const active = e.view.dom.querySelectorAll('.is-active-card')
    expect(active.length).toBe(1)
    expect(active[0].getAttribute('data-card-id')).toBe('a')
    e.destroy()
  })

  it('光标移到别的卡，标记跟着走', () => {
    const e = threeCards()
    e.commands.setTextSelection(2)
    expect(e.view.dom.querySelector('.is-active-card')?.getAttribute('data-card-id')).toBe('a')

    const second = e.state.doc.child(0).nodeSize + 2
    e.commands.setTextSelection(second)
    const active = e.view.dom.querySelectorAll('.is-active-card')
    expect(active.length).toBe(1)
    expect(active[0].getAttribute('data-card-id')).toBe('b')
    e.destroy()
  })
})
