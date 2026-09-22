import { describe, it, expect } from 'vitest'
import { buildItems, paraRuns, sliceRuns } from './TypesetView'

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
