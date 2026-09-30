import { describe, it, expect } from 'vitest'
import { parsePrepResponse } from './parse'

function goodCandidate(over: Record<string, unknown> = {}) {
  return { en: 'hem in', verify_form: 'hem in', register: '书面', nuance: '包围', why_fits: '贴', loses: '没有对峙感', ...over }
}
function goodTarget(over: Record<string, unknown> = {}) {
  return {
    zh: '堵', zh_quote: '把邻居堵在卧室里', category: '动作质感', priority: 1,
    why_zh_is_precise: '强弱易位', flat_translation: { text: 'block', why_it_dies: '没生命' },
    candidates: [goodCandidate()], no_single_word: false, family: '剥夺退路的掌控', ...over,
  }
}
const good = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ genre: 'narrative', genre_reason: '动作细节多', targets: [goodTarget()], ...over })

describe('parsePrepResponse', () => {
  it('形状正确就通过，并把 snake_case 转成 camelCase', () => {
    const r = parsePrepResponse(good())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.genre).toBe('narrative')
    expect(r.value.targets[0].candidates[0].verifyForm).toBe('hem in')
    expect(r.value.targets[0].whyZhIsPrecise).toBe('强弱易位')
    expect(r.value.targets[0].flatTranslation.whyItDies).toBe('没生命')
  })

  it('不是 JSON 就拒收，不抛出', () => {
    expect(parsePrepResponse('这不是 JSON').ok).toBe(false)
  })

  it('候选缺 loses 一律拒收——没有任何候选可以只有优点', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({ candidates: [goodCandidate({ loses: '' })] })] }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('loses')
  })

  it('loses 写成「无」「N/A」这类也算缺', () => {
    for (const v of ['无', 'N/A', 'none', '—', '  ', '不适用']) {
      expect(parsePrepResponse(good({ targets: [goodTarget({ candidates: [goodCandidate({ loses: v })] })] })).ok).toBe(false)
    }
  })

  it('verify_form 超过 5 个词就拒收——查不到的词形会让查证层误报', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({
      candidates: [goodCandidate({ verify_form: 'one two three four five six' })] })] }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('verify_form')
  })

  it('verify_form 恰好 5 个词是合法的', () => {
    expect(parsePrepResponse(good({ targets: [goodTarget({
      candidates: [goodCandidate({ verify_form: 'one two three four five' })] })] })).ok).toBe(true)
  })

  it('叙事文体里出现「承重句」分类就拒收——叙事没有论点句', () => {
    const r = parsePrepResponse(good({ genre: 'narrative', targets: [goodTarget({ category: '承重句' })] }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('承重句')
  })

  it('议论文体里「承重句」是合法分类', () => {
    expect(parsePrepResponse(good({ genre: 'expository', targets: [goodTarget({ category: '承重句' })] })).ok).toBe(true)
  })

  it('任何字段里塞进整句英文就拒收——schema 里不该有句子', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({
      candidates: [goodCandidate({ nuance: 'A palm-sized kitten had hemmed the neighbors in their own bedroom and waited.' })] })] }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('句子')
  })

  it('靶心列表为空就拒收', () => {
    expect(parsePrepResponse(good({ targets: [] })).ok).toBe(false)
  })

  it('候选一个都没有的靶心被拒收', () => {
    expect(parsePrepResponse(good({ targets: [goodTarget({ candidates: [] })] })).ok).toBe(false)
  })

  it('按 priority 排序——承重句和歧义那类排最前', () => {
    const r = parsePrepResponse(good({ targets: [
      goodTarget({ zh: '低', priority: 3 }),
      goodTarget({ zh: '高', priority: 1 }),
    ] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets.map((t) => t.zh)).toEqual(['高', '低'])
  })

  it('未知文体退化成 other，不拒收', () => {
    const r = parsePrepResponse(good({ genre: '诗' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.genre).toBe('other')
  })
})
