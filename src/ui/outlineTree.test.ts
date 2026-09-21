import { describe, it, expect } from 'vitest'
import { outlineTreeFromDoc, outlineRowWords } from './LeftNav'

function card(cardId: string, paragraphs: any[], attrs: Record<string, any> = {}) {
  return { type: 'card', attrs: { cardId, color: null, ...attrs }, content: paragraphs }
}

function paragraph(text: string, style?: string) {
  return { type: 'paragraph', attrs: style ? { style } : undefined, content: text ? [{ type: 'text', text }] : [] }
}

function basicDoc() {
  return {
    type: 'doc',
    content: [
      card('c0', [paragraph('章A', 'chapter')]),
      card('c1', [paragraph('正文一')]),
      card('c2', [paragraph('正文二')]),
      card('c3', [paragraph('节B', 'h1')]),
      card('c4', [paragraph('正文三')]),
    ],
  }
}

describe('outlineTreeFromDoc', () => {
  it('返回 5 行，层级/kind/cardIndex 正确，块行挂在对应标题下', () => {
    const rows = outlineTreeFromDoc(basicDoc())
    expect(rows).toHaveLength(5)
    expect(rows.map((r) => [r.kind, r.level, r.cardIndex])).toEqual([
      ['heading', 1, 0],
      ['block', 2, 1],
      ['block', 2, 2],
      ['heading', 2, 3],
      ['block', 3, 4],
    ])
  })

  it('heading 行 text/note 取自标题段落', () => {
    const doc = {
      type: 'doc',
      content: [card('c0', [paragraph('章A', 'chapter')])],
    }
    // 手动塞一个 note 到标题段落
    ;(doc.content[0].content[0] as any).attrs.note = '章节说明'
    const rows = outlineTreeFromDoc(doc)
    expect(rows[0]).toMatchObject({ kind: 'heading', level: 1, text: '章A', note: '章节说明', cardIndex: 0 })
  })

  // Phase 14 Task 1 #4：preview 不再在这里固定截到 N 字——完整文字原样保留，
  // 交给渲染层的单行省略容器（.outline-preview-ellipsis）按实际行宽截断。
  it('block 行 text/preview 取自卡片纯文本（preview 是完整文本，不截断），note 取自 card.note', () => {
    const doc = {
      type: 'doc',
      content: [card('c0', [paragraph('这是一段比较长的正文用于测试预览截断效果')], { note: '块备注' })],
    }
    const rows = outlineTreeFromDoc(doc)
    expect(rows[0].kind).toBe('block')
    expect(rows[0].note).toBe('块备注')
    expect(rows[0].text).toBe('这是一段比较长的正文用于测试预览截断效果')
    expect(rows[0].preview).toBe('这是一段比较长的正文用于测试预览截断效果')
  })

  it('空卡（无文字）preview 是空串', () => {
    const doc = { type: 'doc', content: [card('c0', [paragraph('')])] }
    const rows = outlineTreeFromDoc(doc)
    expect(rows[0].preview).toBe('')
    expect(rows[0].text).toBe('')
  })

  it('没有 note 的块行 note 为空，preview 仍能从正文取到（供 UI 兜底展示）', () => {
    const doc = { type: 'doc', content: [card('c0', [paragraph('无备注的块')])] }
    const rows = outlineTreeFromDoc(doc)
    expect(rows[0].note).toBe('')
    expect(rows[0].preview).toBe('无备注的块')
  })

  it('第一张卡在任何标题之前时，块行 level 为 1', () => {
    const doc = { type: 'doc', content: [card('c0', [paragraph('开篇正文')])] }
    const rows = outlineTreeFromDoc(doc)
    expect(rows[0]).toMatchObject({ kind: 'block', level: 1, cardIndex: 0 })
  })

  it('向后兼容：card 没有 note 字段也能正常解析，note 为空串', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'card', attrs: { cardId: 'c0' }, content: [paragraph('老卡')] }],
    }
    const rows = outlineTreeFromDoc(doc)
    expect(rows[0].note).toBe('')
  })
})

// 字数：每行 words = 这张卡自己的字数；outlineRowWords 对标题行返回整段累计
// （标题卡 + 管辖范围内所有块和子标题，范围同 outlineSectionRange）。
describe('outline 字数', () => {
  function countDoc() {
    return {
      type: 'doc',
      content: [
        card('c0', [paragraph('开篇')]), // 标题之前的块：2
        card('c1', [paragraph('第一章', 'chapter')]), // 3
        card('c2', [paragraph('他说“好”')]), // 5
        card('c3', [paragraph('小节', 'h1')]), // 2
        card('c4', [paragraph('hello world'), paragraph('再见')]), // 2 + 2
        card('c5', [paragraph('第二章', 'chapter')]), // 3
        card('c6', [paragraph('')]), // 0
      ],
    }
  }

  it('每行 words 是这张卡自己的字数（标题卡算标题文字）', () => {
    const rows = outlineTreeFromDoc(countDoc())
    expect(rows.map((r) => r.words)).toEqual([2, 3, 5, 2, 4, 3, 0])
  })

  it('块行的 outlineRowWords 就是自己的字数', () => {
    const rows = outlineTreeFromDoc(countDoc())
    expect(outlineRowWords(rows, 0)).toBe(2)
    expect(outlineRowWords(rows, 2)).toBe(5)
    expect(outlineRowWords(rows, 6)).toBe(0)
  })

  it('章标题行累计整章（含子节），不越过下一章', () => {
    const rows = outlineTreeFromDoc(countDoc())
    expect(outlineRowWords(rows, 1)).toBe(3 + 5 + 2 + 4)
    expect(outlineRowWords(rows, 5)).toBe(3)
  })

  it('节标题行只累计到本节结束', () => {
    const rows = outlineTreeFromDoc(countDoc())
    expect(outlineRowWords(rows, 3)).toBe(2 + 4)
  })

  it('折叠不影响累计', () => {
    const doc = countDoc()
    ;(doc.content[1].content[0] as any).attrs.collapsed = true
    const rows = outlineTreeFromDoc(doc)
    expect(outlineRowWords(rows, 1)).toBe(14)
  })
})
