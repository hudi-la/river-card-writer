import { describe, it, expect } from 'vitest'
import {
  fingerprint, isStale, isValidEn, STALE_SRC,
  zhFingerprint, splitEn, mergeEn,
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

describe('isStale', () => {
  it('没写过英文（en 为 null）不算过期，算未写', () => {
    expect(isStale(null, STALE_SRC, '猫堵住了门')).toBe(false)
  })
  it('指纹对得上就是新鲜的', () => {
    const zh = '猫堵住了门'
    expect(isStale(['The cat barred the door.'], fingerprint(zh), zh)).toBe(false)
  })
  it('中文改过、指纹对不上就是过期', () => {
    expect(isStale(['The cat barred the door.'], fingerprint('猫堵住了门'), '猫堵住了窗')).toBe(true)
  })
  it('enSrc 是空串 = 被显式标记为过期（指纹永远匹配不上空串）', () => {
    expect(isStale(['whatever'], STALE_SRC, '任何中文')).toBe(true)
  })
})

describe('isValidEn', () => {
  it('null 合法——表示没写过', () => {
    expect(isValidEn(null, 3)).toBe(true)
  })
  it('段数相符的字符串数组合法', () => {
    expect(isValidEn(['a', 'b'], 2)).toBe(true)
  })
  it('段数不符不合法——en.length === 段落数 是不变量', () => {
    expect(isValidEn(['a'], 2)).toBe(false)
    expect(isValidEn(['a', 'b', 'c'], 2)).toBe(false)
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
  it('空数组只在段数为 0 时合法', () => {
    expect(isValidEn([], 0)).toBe(true)
    expect(isValidEn([], 1)).toBe(false)
  })
})

describe('splitEn', () => {
  const zh = ['第一段', '第二段', '第三段']
  const en = ['One.', 'Two.', 'Three.']

  it('在段落边界下刀且段数对齐：英文在同一个段序号上切开，两半都保持新鲜', () => {
    const r = splitEn(en, zh, 1, true)
    expect(r.first.en).toEqual(['One.'])
    expect(r.second.en).toEqual(['Two.', 'Three.'])
    expect(r.first.enSrc).toBe(zhFingerprint(['第一段']))
    expect(r.second.enSrc).toBe(zhFingerprint(['第二段', '第三段']))
  })
  it('在段落中间下刀：英文整份留给前半张，两半都不新鲜', () => {
    const r = splitEn(en, zh, 1, false)
    expect(r.first.en).toEqual(en)
    expect(r.first.enSrc).toBe(STALE_SRC)
    expect(r.second.en).toBe(null)
  })
  it('英文段数和中文段数不符：不敢对齐，整份留给前半张并标过期', () => {
    const r = splitEn(['Only one.'], zh, 1, true)
    expect(r.first.en).toEqual(['Only one.'])
    expect(r.first.enSrc).toBe(STALE_SRC)
    expect(r.second.en).toBe(null)
  })
  it('没写过英文：两半都还是没写过，不是过期', () => {
    const r = splitEn(null, zh, 1, true)
    expect(r.first.en).toBe(null)
    expect(r.second.en).toBe(null)
    expect(r.first.enSrc).toBe(STALE_SRC)
  })
  it('index 为 0 或等于段数时无法对齐（会切出空的一半）', () => {
    expect(splitEn(en, zh, 0, true).first.enSrc).toBe(STALE_SRC)
    expect(splitEn(en, zh, 3, true).first.enSrc).toBe(STALE_SRC)
  })
})

describe('mergeEn', () => {
  it('两边都写过：拼接，并按合并后的中文重算指纹，保持新鲜', () => {
    const r = mergeEn(['One.'], ['Two.'], ['第一段', '第二段'])
    expect(r.en).toEqual(['One.', 'Two.'])
    expect(r.enSrc).toBe(zhFingerprint(['第一段', '第二段']))
  })
  it('只有前一张写过：保留它的英文但标过期——那份英文盖不全合并后的中文', () => {
    const r = mergeEn(['One.'], null, ['第一段', '第二段'])
    expect(r.en).toEqual(['One.'])
    expect(r.enSrc).toBe(STALE_SRC)
  })
  it('只有后一张写过：同样保留并标过期，绝不丢掉作者写过的字', () => {
    const r = mergeEn(null, ['Two.'], ['第一段', '第二段'])
    expect(r.en).toEqual(['Two.'])
    expect(r.enSrc).toBe(STALE_SRC)
  })
  it('两边都没写过：还是没写过', () => {
    const r = mergeEn(null, null, ['第一段', '第二段'])
    expect(r.en).toBe(null)
    expect(r.enSrc).toBe(STALE_SRC)
  })
})
