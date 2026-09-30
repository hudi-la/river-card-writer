import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function docWith(attrs: Record<string, unknown>) {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
      ],
    },
  })
}

describe('card 的英文属性', () => {
  it('新卡默认 en 为 null、enSrc/enAt 为空串', () => {
    const e = docWith({ cardId: 'c0' })
    const a = e.getJSON().content![0].attrs!
    expect(a.en).toBe(null)
    expect(a.enSrc).toBe('')
    expect(a.enAt).toBe('')
    e.destroy()
  })

  it('老文档（JSON 里没有这三个字段）解析后也是默认值，老属性不受影响', () => {
    const e = docWith({ cardId: 'c0', color: '#7fa3c4', note: '梗概' })
    const a = e.getJSON().content![0].attrs!
    expect(a.en).toBe(null)
    expect(a.enSrc).toBe('')
    expect(a.color).toBe('#7fa3c4')
    expect(a.note).toBe('梗概')
    e.destroy()
  })

  it('en 能原样往返 JSON', () => {
    const e = docWith({ cardId: 'c0', en: ['The cat barred the door.'], enSrc: 'fabc', enAt: '2026-09-29T00:00:00Z' })
    const a = e.getJSON().content![0].attrs!
    expect(a.en).toEqual(['The cat barred the door.'])
    expect(a.enSrc).toBe('fabc')
    expect(a.enAt).toBe('2026-09-29T00:00:00Z')
    e.destroy()
  })

  it('HTML 往返时形状不对的 en 被当成没写过', () => {
    const e = new Editor({
      extensions: baseExtensions,
      // 一段中文却给两段英文——不变量破了，parseHTML 必须拒收
      content: '<section data-card-id="c0" data-en="[&quot;one&quot;,&quot;two&quot;]"><p>第一段</p></section>',
    })
    expect(e.getJSON().content![0].attrs!.en).toBe(null)
    e.destroy()
  })

  it('HTML 里 data-en 不是合法 JSON 时也当没写过，不抛出', () => {
    const e = new Editor({
      extensions: baseExtensions,
      content: '<section data-card-id="c0" data-en="{坏的"><p>第一段</p></section>',
    })
    expect(e.getJSON().content![0].attrs!.en).toBe(null)
    e.destroy()
  })
})
