import { describe, it, expect } from 'vitest'
import {
  UNCONFIRMED,
  collectEnText,
  confirmState,
  fingerprint,
  isValidEn,
  mergeEn,
  mergeEnCells,
  splitEn,
  splitEnCell,
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

describe('mergeEnCells：作者自己改英文的分段', () => {
  it('把后一段并进前一段，接缝补一个空格，光标停在接缝上', () => {
    const r = mergeEnCells(['One.', 'Two.', 'Three.'], 1, 'Two.')
    expect(r).toEqual({ en: ['One. Two.', 'Three.'], caret: 'One. '.length })
  })

  it('用的是传进来的实时文字，不是 en[index]——格子失焦才写回，en 可能是旧的', () => {
    const r = mergeEnCells(['One.', '旧值'], 1, 'Two, just typed.')
    expect(r!.en).toEqual(['One. Two, just typed.'])
  })

  it('接缝两侧已有空白就不再补——作者敲在段尾的换行原样留着', () => {
    expect(mergeEnCells(['One.\n', 'Two.'], 1, 'Two.')!.en).toEqual(['One.\nTwo.'])
    expect(mergeEnCells(['One.', ' Two.'], 1, ' Two.')!.en).toEqual(['One. Two.'])
  })

  it('有一边是空的就不补空格，也不留下多余的空白', () => {
    expect(mergeEnCells(['', 'Two.'], 1, 'Two.')).toEqual({ en: ['Two.'], caret: 0 })
    expect(mergeEnCells(['One.', ''], 1, '')).toEqual({ en: ['One.'], caret: 'One.'.length })
  })

  it('第一段没有"前一段"可并，返回 null（让 Backspace 照常删字符）', () => {
    expect(mergeEnCells(['One.', 'Two.'], 0, 'One.')).toBeNull()
  })

  it('压根没写过英文时没有可合的东西', () => {
    expect(mergeEnCells(null, 1, 'x')).toBeNull()
  })

  it('合的是中文那边没有对应段落的多余段时，照样能合回去', () => {
    // 中文 2 段、英文 4 段：把第 4 段并进第 3 段
    const r = mergeEnCells(['A.', 'B.', 'C.', 'D.'], 3, 'D.')
    expect(r!.en).toEqual(['A.', 'B.', 'C. D.'])
  })
})

describe('splitEnCell：作者自己加一段英文', () => {
  it('在光标处拆成两段，光标跟到新那段的开头', () => {
    const r = splitEnCell(['One. Two.', 'Three.'], 0, 'One. Two.', 'One. '.length)
    expect(r).toEqual({ en: ['One.', 'Two.', 'Three.'], focusIndex: 1, caret: 0 })
  })

  it('接缝处剥掉空白，跟 mergeEnCells 补空格正好互逆', () => {
    const split = splitEnCell(['One. Two.'], 0, 'One. Two.', 'One. '.length)
    expect(split.en).toEqual(['One.', 'Two.'])
    const back = mergeEnCells(split.en, 1, 'Two.')
    expect(back!.en).toEqual(['One. Two.'])
  })

  it('在段尾按 Enter 就是开一个空段——这是"加一段"最常走的路', () => {
    const r = splitEnCell(['One.'], 0, 'One.', 'One.'.length)
    expect(r.en).toEqual(['One.', ''])
    expect(r.focusIndex).toBe(1)
  })

  it('在段首按 Enter，前面留一个空段，光标留在原文那一段', () => {
    const r = splitEnCell(['One.'], 0, 'One.', 0)
    expect(r.en).toEqual(['', 'One.'])
    expect(r.focusIndex).toBe(1)
  })

  it('拆后面的段不动前面的段', () => {
    const r = splitEnCell(['A.', 'B. C.', 'D.'], 1, 'B. C.', 'B. '.length)
    expect(r.en).toEqual(['A.', 'B.', 'C.', 'D.'])
    expect(r.focusIndex).toBe(2)
  })

  it('用的是格子里的实时文字，不是写回过的旧值', () => {
    const r = splitEnCell(['旧值'], 0, 'Just typed. More.', 'Just typed. '.length)
    expect(r.en).toEqual(['Just typed.', 'More.'])
  })

  it('还没写过英文时也能拆，不会把别的格子变出内容来', () => {
    const r = splitEnCell(null, 2, 'One. Two.', 'One. '.length)
    expect(r.en).toEqual(['', '', 'One.', 'Two.'])
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
