import { describe, it, expect } from 'vitest'
import {
  UNCONFIRMED,
  collectEnText,
  confirmState,
  enToText,
  fingerprint,
  isValidEn,
  mergeEn,
  paragraphsToHtml,
  readParagraphs,
  splitEn,
  textToEn,
  zhFingerprint,
} from './enText'

describe('fingerprint', () => {
  it('同样的文本给同样的指纹', () => {
    expect(fingerprint('猫堵住了门')).toBe(fingerprint('猫堵住了门'))
  })
  it('文本不同则指纹不同', () => {
    expect(fingerprint('猫堵住了门')).not.toBe(fingerprint('猫堵住了窗'))
  })
  it('只差空白不算改动——改一个空格不该让英文过期', () => {
    expect(fingerprint('猫 堵住了门')).toBe(fingerprint('猫  堵住了门 '))
  })
  it('空文本也有指纹，且不等于空串（空串是"过期"的哨兵）', () => {
    expect(fingerprint('')).not.toBe('')
  })
})

describe('confirmState', () => {
  const zh = '猫堵住了门'

  it('没写过是 unwritten', () => {
    expect(confirmState(null, UNCONFIRMED, zh)).toBe('unwritten')
  })

  it('写了但没点过确认是 unconfirmed——中性状态，不该报警', () => {
    expect(confirmState(['The cat barred the door.'], UNCONFIRMED, zh)).toBe('unconfirmed')
  })

  it('认过且中文没再变是 confirmed', () => {
    expect(confirmState(['x'], fingerprint(zh), zh)).toBe('confirmed')
  })

  it('认过但之后中文改了是 invalidated——作者认的是配那一版中文的那些字', () => {
    expect(confirmState(['x'], fingerprint('猫堵住了门'), '猫堵住了窗')).toBe('invalidated')
  })

  it('改空白不算中文变了，确认还在', () => {
    expect(confirmState(['x'], fingerprint('猫 堵住了门'), '猫  堵住了门 ')).toBe('confirmed')
  })
})

describe('isValidEn', () => {
  it('null 合法——表示没写过', () => {
    expect(isValidEn(null, 3)).toBe(true)
  })
  it('段数相符的字符串数组合法', () => {
    expect(isValidEn(['a', 'b'], 2)).toBe(true)
  })
  it('段数不符也合法——作者的字不该因为结构对不上而消失', () => {
    // 原来这里要求长度严格相等。那是会丢数据的设计：删掉一段中文之后 en 被判
    // 不合格 → CardView 当它是 null → 下次敲字用空串把它整份覆盖掉。
    expect(isValidEn(['a'], 2)).toBe(true)
    expect(isValidEn(['a', 'b', 'c'], 2)).toBe(true)
  })
  it('非数组不合法', () => {
    expect(isValidEn('a', 1)).toBe(false)
    expect(isValidEn({ 0: 'a' }, 1)).toBe(false)
    expect(isValidEn(undefined, 1)).toBe(false)
  })
  it('数组里有非字符串不合法', () => {
    expect(isValidEn(['a', 42], 2)).toBe(false)
    expect(isValidEn(['a', null], 2)).toBe(false)
  })
  it('空数组合法', () => {
    expect(isValidEn([], 0)).toBe(true)
    expect(isValidEn([], 1)).toBe(true)
  })
})

describe('splitEn', () => {
  const zh = ['第一段', '第二段', '第三段']
  const en = ['One.', 'Two.', 'Three.']

  it('在段落边界下刀且段数对齐：英文在同一个段序号上切开', () => {
    const r = splitEn(en, zh, 1, true)
    expect(r.first.en).toEqual(['One.'])
    expect(r.second.en).toEqual(['Two.', 'Three.'])
  })

  it('原来没确认过，切完两半也都没确认——绝不替作者盖章', () => {
    const r = splitEn(en, zh, 1, true, false)
    expect(r.first.enSrc).toBe(UNCONFIRMED)
    expect(r.second.enSrc).toBe(UNCONFIRMED)
  })

  it('原来确认过，能对齐时两半都保留确认——切一刀没改动任何一个字', () => {
    const r = splitEn(en, zh, 1, true, true)
    expect(r.first.enSrc).toBe(zhFingerprint(['第一段']))
    expect(r.second.enSrc).toBe(zhFingerprint(['第二段', '第三段']))
  })

  it('确认过但对不齐时，一律退回未确认——对应关系已经不是作者认过的那个了', () => {
    const r = splitEn(en, zh, 1, false, true)
    expect(r.first.enSrc).toBe(UNCONFIRMED)
    expect(r.second.enSrc).toBe(UNCONFIRMED)
  })
  it('在段落中间下刀：英文整份留给前半张，两半都不新鲜', () => {
    const r = splitEn(en, zh, 1, false)
    expect(r.first.en).toEqual(en)
    expect(r.first.enSrc).toBe(UNCONFIRMED)
    expect(r.second.en).toBe(null)
  })
  it('英文段数和中文段数不符：不敢对齐，整份留给前半张并标过期', () => {
    const r = splitEn(['Only one.'], zh, 1, true)
    expect(r.first.en).toEqual(['Only one.'])
    expect(r.first.enSrc).toBe(UNCONFIRMED)
    expect(r.second.en).toBe(null)
  })
  it('没写过英文：两半都还是没写过，不是过期', () => {
    const r = splitEn(null, zh, 1, true)
    expect(r.first.en).toBe(null)
    expect(r.second.en).toBe(null)
    expect(r.first.enSrc).toBe(UNCONFIRMED)
  })
  it('index 为 0 或等于段数时无法对齐（会切出空的一半）', () => {
    expect(splitEn(en, zh, 0, true).first.enSrc).toBe(UNCONFIRMED)
    expect(splitEn(en, zh, 3, true).first.enSrc).toBe(UNCONFIRMED)
  })
})

describe('mergeEn', () => {
  it('两边都写过：拼接', () => {
    const r = mergeEn(['One.'], ['Two.'], ['第一段', '第二段'])
    expect(r.en).toEqual(['One.', 'Two.'])
  })

  it('默认不盖确认章——系统替作者认一次是最不该发生的事', () => {
    expect(mergeEn(['One.'], ['Two.'], ['第一段', '第二段']).enSrc).toBe(UNCONFIRMED)
  })

  it('只有两边都确认过，合并结果才算确认', () => {
    const r = mergeEn(['One.'], ['Two.'], ['第一段', '第二段'], true)
    expect(r.enSrc).toBe(zhFingerprint(['第一段', '第二段']))
  })
  it('只有前一张写过：保留它的英文但标过期——那份英文盖不全合并后的中文', () => {
    const r = mergeEn(['One.'], null, ['第一段', '第二段'])
    expect(r.en).toEqual(['One.'])
    expect(r.enSrc).toBe(UNCONFIRMED)
  })
  it('只有后一张写过：同样保留并标过期，绝不丢掉作者写过的字', () => {
    const r = mergeEn(null, ['Two.'], ['第一段', '第二段'])
    expect(r.en).toEqual(['Two.'])
    expect(r.enSrc).toBe(UNCONFIRMED)
  })
  it('两边都没写过：还是没写过', () => {
    const r = mergeEn(null, null, ['第一段', '第二段'])
    expect(r.en).toBe(null)
    expect(r.enSrc).toBe(UNCONFIRMED)
  })
})

describe('collectEnText：把整篇英文收成能粘走的纯文本', () => {
  const doc = (...cards: Array<string[] | null>) => ({
    type: 'doc',
    content: cards.map((en) => ({ type: 'card', attrs: { en }, content: [] })),
  })

  it('跨卡按顺序收齐，段落之间空一行', () => {
    expect(collectEnText(doc(['One.', 'Two.'], ['Three.']))).toBe('One.\n\nTwo.\n\nThree.')
  })

  it('还没写英文的卡直接跳过，不留空档', () => {
    expect(collectEnText(doc(['One.'], null, ['Two.']))).toBe('One.\n\nTwo.')
  })

  it('空段落不输出——段尾按 Enter 开出来的空段不该在粘贴结果里留白行', () => {
    expect(collectEnText(doc(['One.', '', '  ', 'Two.']))).toBe('One.\n\nTwo.')
  })

  it('段内作者自己敲的换行原样留着', () => {
    expect(collectEnText(doc(['Line one.\nLine two.']))).toBe('Line one.\nLine two.')
  })

  it('形状不对的 en 跳过，不崩', () => {
    expect(collectEnText(doc('不是数组' as never, ['One.']))).toBe('One.')
    expect(collectEnText(null)).toBe('')
    expect(collectEnText({})).toBe('')
  })
})

describe('enToText / textToEn：存的是段落数组，编辑的是一整块文字', () => {
  it('空行分段，往返不变形', () => {
    expect(enToText(['One.', 'Two.'])).toBe('One.\n\nTwo.')
    expect(textToEn('One.\n\nTwo.')).toEqual(['One.', 'Two.'])
  })

  it('段内单个换行是作者自己的断行，不当成分段', () => {
    expect(textToEn('Line one.\nLine two.')).toEqual(['Line one.\nLine two.'])
    expect(enToText(['Line one.\nLine two.'])).toBe('Line one.\nLine two.')
  })

  it('多敲的空行归一成一个空行——写回时顺手收拾一次', () => {
    expect(textToEn('One.\n\n\n\nTwo.')).toEqual(['One.', 'Two.'])
  })

  it('空白段落不存', () => {
    expect(textToEn('One.\n\n   \n\nTwo.')).toEqual(['One.', 'Two.'])
    expect(textToEn('   ')).toEqual([])
    expect(textToEn('')).toEqual([])
  })

  it('还没写过英文时摊出来是空字符串', () => {
    expect(enToText(null)).toBe('')
  })
})

describe('paragraphsToHtml / readParagraphs：写出去和读回来必须严格相等', () => {
  const read = (html: string) => {
    const el = document.createElement('div')
    el.innerHTML = html
    return readParagraphs(el)
  }

  it('往返不变形', () => {
    for (const ps of [
      ['One.'],
      ['One.', 'Two.'],
      ['One.', 'Two.', 'Three.'],
      ['Line one.\nLine two.'],
      ['One.', 'Two.\nstill two.', 'Three.'],
    ]) {
      expect(read(paragraphsToHtml(ps))).toEqual(ps)
    }
  })

  it('HTML 特殊字符不会被当成标签——作者写 a < b 就得存成 a < b', () => {
    expect(read(paragraphsToHtml(['a < b & c > d']))).toEqual(['a < b & c > d'])
    expect(paragraphsToHtml(['<b>x</b>'])).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
    expect(read(paragraphsToHtml(['<b>x</b>']))).toEqual(['<b>x</b>'])
  })

  it('浏览器按回车给 div 还是 p 都当段落边界——换浏览器不会变形', () => {
    expect(read('<div>One.</div><div>Two.</div>')).toEqual(['One.', 'Two.'])
    expect(read('<p>One.</p><div>Two.</div>')).toEqual(['One.', 'Two.'])
  })

  it('顶层的裸文本节点归到当前这一段——有些浏览器第一行不包块', () => {
    expect(read('One.<div>Two.</div>')).toEqual(['One.', 'Two.'])
    expect(read('One.<br>still one.<div>Two.</div>')).toEqual(['One.\nstill one.', 'Two.'])
  })

  it('空段落不存，但写出去时得有 <br> 撑着——否则光标进不去', () => {
    expect(paragraphsToHtml([])).toBe('<p><br></p>')
    expect(paragraphsToHtml(['', 'Two.'])).toBe('<p><br></p><p>Two.</p>')
    expect(read('<p><br></p><p>Two.</p>')).toEqual(['Two.'])
    expect(read('<p><br></p>')).toEqual([])
  })

  it('粘贴万一带进了行内标签，读回来只剩文字——纯文本是硬保证', () => {
    expect(read('<p>plain <b>bold</b> <span style="font-size:40px">big</span></p>')).toEqual([
      'plain bold big',
    ])
  })
})
