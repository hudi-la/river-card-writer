import { describe, it, expect } from 'vitest'
import { buildItems, numberHeadings, paraRuns, sliceRuns } from './TypesetView'

// 排版视图以前只取纯文本，强调/删除/refer 这些行内标记在「阅读」里全看不见。
// 现在每段带一串 run（text + 标记），分页时按字数切 run。

const para = (text: string, marks?: string[]) => ({
  type: 'paragraph',
  attrs: { style: 'body' },
  content: [{ type: 'text', text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) }],
})

describe('paraRuns', () => {
  it('没有标记的段落是一个裸 run', () => {
    expect(paraRuns(para('一句话。'))).toEqual([{ text: '一句话。' }])
  })

  it('把 mark 翻成 run 上的标志', () => {
    expect(
      paraRuns({
        type: 'paragraph',
        content: [
          { type: 'text', text: '他说' },
          { type: 'text', text: '别等他', marks: [{ type: 'emphasis' }] },
          { type: 'text', text: '，然后' },
          { type: 'text', text: '走了', marks: [{ type: 'strike' }] },
        ],
      }),
    ).toEqual([
      { text: '他说' },
      { text: '别等他', em: true },
      { text: '，然后' },
      { text: '走了', strike: true },
    ])
  })

  it('一段文字同时带几个 mark', () => {
    expect(paraRuns(para('引文', ['emphasis', 'refer']))).toEqual([{ text: '引文', em: true, refer: true }])
  })

  it('空段落是空数组', () => {
    expect(paraRuns({ type: 'paragraph', content: [] })).toEqual([])
  })
})

describe('sliceRuns', () => {
  const runs = [{ text: '前面' }, { text: '重点', em: true as const }, { text: '后面' }]

  it('按字数区间切，标记跟着切出来的那一半走', () => {
    expect(sliceRuns(runs, 0, 3)).toEqual([{ text: '前面' }, { text: '重', em: true }])
    expect(sliceRuns(runs, 3, 8)).toEqual([{ text: '点', em: true }, { text: '后面' }])
  })

  it('整段取回来就是原样', () => {
    expect(sliceRuns(runs, 0, 8)).toEqual(runs)
  })

  it('空区间是空数组', () => {
    expect(sliceRuns(runs, 4, 4)).toEqual([])
  })

  it('切在 run 边界上不留空 run', () => {
    expect(sliceRuns(runs, 0, 2)).toEqual([{ text: '前面' }])
    expect(sliceRuns(runs, 2, 4)).toEqual([{ text: '重点', em: true }])
  })
})

describe('buildItems 带标记', () => {
  it('每一项都带 runs，且 runs 拼起来等于 text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'card',
          content: [
            {
              type: 'paragraph',
              attrs: { style: 'body' },
              content: [
                { type: 'text', text: '他说' },
                { type: 'text', text: '别等他', marks: [{ type: 'emphasis' }] },
              ],
            },
            para('第二段。'),
          ],
        },
      ],
    }
    const items = buildItems(doc)
    expect(items[0].runs).toEqual([{ text: '他说' }, { text: '别等他', em: true }])
    expect(items.map((it) => it.runs.map((r) => r.text).join(''))).toEqual([it0Text(items), '第二段。'])
  })
})

// items[0].text 就是这一段的纯文本，runs 拼起来必须跟它一致——分页是按字数算的，
// 两者一旦对不上，切出来的位置就会错。
function it0Text(items: ReturnType<typeof buildItems>) {
  return items[0].text
}

// 阅读模式的语言档（中 / 英 / 对照）和论文版的标题编号。
const styled = (text: string, style: string) => ({ type: 'paragraph', attrs: { style }, content: [{ type: 'text', text }] })
const card = (paras: any[], en?: string[]) => ({ type: 'card', attrs: { en: en ?? null }, content: paras })

describe('buildItems 的语言档', () => {
  const doc = {
    content: [
      card([styled('第一章', 'chapter'), para('他走了。')], ['Chapter One', 'He left.']),
      card([para('没翻的一段。')]),
      card([para('甲。'), para('乙。')], ['A and B in one.']),
    ],
  }

  it('zh：只有中文，跟以前一样', () => {
    expect(buildItems(doc, 'zh').map((i) => i.text)).toEqual(['第一章', '他走了。', '没翻的一段。', '甲。', '乙。'])
    expect(buildItems(doc, 'zh').some((i) => i.en || i.pending)).toBe(false)
  })

  it('en：段数对得上时继承中文样式；没写英文的卡退回中文并标 pending；对不上全当正文', () => {
    const items = buildItems(doc, 'en')
    expect(items.map((i) => [i.type, i.text, !!i.en, !!i.pending])).toEqual([
      ['chapter', 'Chapter One', true, false],
      ['body', 'He left.', true, false],
      ['body', '没翻的一段。', false, true],
      ['body', 'A and B in one.', true, false],
    ])
  })

  it('both：每张卡先中后英，英文标 echo', () => {
    const items = buildItems(doc, 'both')
    expect(items.map((i) => i.text)).toEqual(['第一章', '他走了。', 'Chapter One', 'He left.', '没翻的一段。', '甲。', '乙。', 'A and B in one.'])
    expect(items[2].echo).toBe(true)
  })

  it('英文里单个换行也算分段（跟英文栏一致）', () => {
    const items = buildItems({ content: [card([para('一'), para('二')], ['One\nTwo'])] }, 'en')
    expect(items.map((i) => [i.type, i.text])).toEqual([['body', 'One'], ['body', 'Two']])
  })
})

describe('numberHeadings', () => {
  const nums = (items: any[]) => numberHeadings(items).filter((i) => i.type !== 'body').map((i) => i.runs[0].text.trim())

  it('只数出现过的层级：没有章时 h1 就是 1、h2 是 1.1', () => {
    const doc = { content: [card([styled('甲', 'h1'), styled('子', 'h2'), styled('丑', 'h2'), styled('乙', 'h1'), styled('寅', 'h2')])] }
    expect(nums(buildItems(doc))).toEqual(['1', '1.1', '1.2', '2', '2.1'])
  })

  it('对照模式下英文标题沿用中文那条的编号', () => {
    const doc = { content: [card([styled('甲', 'h1')], ['Alpha']), card([styled('乙', 'h1')], ['Beta'])] }
    expect(nums(buildItems(doc, 'both'))).toEqual(['1', '1', '2', '2'])
  })
})
