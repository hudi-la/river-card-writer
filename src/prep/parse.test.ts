import { describe, it, expect } from 'vitest'
import { parsePrepResponse, parseWordResponse } from './parse'

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

  it('候选缺 loses 就丢掉它，并记一条告警——没有任何候选可以只有优点', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({
      candidates: [goodCandidate({ en: '坏的', loses: '' }), goodCandidate({ en: '好的' })] })] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 只丢那一条，另一条照常留下——那次调用花了半分钟和真钱，不该整份作废
    expect(r.value.targets[0].candidates.map((c) => c.en)).toEqual(['好的'])
    expect(r.warnings.join()).toContain('丢了什么')
  })

  it('loses 写成「无」「N/A」这类也算缺', () => {
    for (const v of ['无', 'N/A', 'none', '—', '  ', '不适用']) {
      const r = parsePrepResponse(good({ targets: [goodTarget({
        candidates: [goodCandidate({ en: '坏的', loses: v }), goodCandidate({ en: '好的' })] })] }))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.targets[0].candidates.map((c) => c.en)).toEqual(['好的'])
    }
  })

  it('一条靶心的候选全不合格时丢掉整条，但别的靶心还在', () => {
    const r = parsePrepResponse(good({ targets: [
      goodTarget({ zh: '全坏', candidates: [goodCandidate({ loses: '无' })] }),
      goodTarget({ zh: '好的' }),
    ] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets.map((t) => t.zh)).toEqual(['好的'])
  })

  it('全军覆没才硬拒，并把第一条原因说出来', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({ candidates: [goodCandidate({ loses: '无' })] })] }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('没有一条合格')
  })

  it('verify_form 超过 5 个词就丢掉那条候选——查不到的词形会让查证层误报', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({
      candidates: [
        goodCandidate({ en: '坏的', verify_form: 'one two three four five six' }),
        goodCandidate({ en: '好的' }),
      ] })] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets[0].candidates.map((c) => c.en)).toEqual(['好的'])
    expect(r.warnings.join()).toContain('verify_form')
  })

  it('verify_form 恰好 5 个词是合法的', () => {
    expect(parsePrepResponse(good({ targets: [goodTarget({
      candidates: [goodCandidate({ verify_form: 'one two three four five' })] })] })).ok).toBe(true)
  })

  it('叙事文体里出现「承重句」分类就改掉它，不丢条目——分类错了不值得丢掉整条', () => {
    const r = parsePrepResponse(good({ genre: 'narrative', targets: [goodTarget({ category: '承重句' })] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets[0].category).not.toBe('承重句')
    expect(r.warnings.join()).toContain('承重句')
  })

  it('议论文体里「承重句」是合法分类', () => {
    expect(parsePrepResponse(good({ genre: 'expository', targets: [goodTarget({ category: '承重句' })] })).ok).toBe(true)
  })

  it('字段里塞进整句英文就丢掉那条候选——条目里不该有句子', () => {
    const r = parsePrepResponse(good({ targets: [goodTarget({
      candidates: [
        goodCandidate({ en: '坏的', nuance: 'A palm-sized kitten had hemmed the neighbors in their own bedroom and waited.' }),
        goodCandidate({ en: '好的' }),
      ] })] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets[0].candidates.map((c) => c.en)).toEqual(['好的'])
    expect(r.warnings.join()).toContain('整句英文')
  })

  it('散落的英文术语不算整句——中文学术文体里本来就夹满英文，按总数算是假警报制造机', () => {
    // 11 个英文词，但全是散落在中文里的术语，没有一段连续 8 词
    const nuance = '强调 relational strategy 的 systematic 性，跟 attachment theory 里的 secure base、' +
      'avoidant pattern、anxious preoccupation 这些 construct 属于同一套 framework'
    const r = parsePrepResponse(good({ targets: [goodTarget({
      candidates: [goodCandidate({ nuance })] })] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets[0].candidates.length).toBe(1)
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


describe('档位决定要不要收整句译文', () => {
  const withTranslation = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      genre: 'narrative', genre_reason: '',
      translation: ['The cat barred the door.'],
      targets: [goodTarget()], ...over,
    })

  it('strict 档下模型夹带 translation 一律拒收——不是忽略，是拒收', () => {
    const r = parsePrepResponse(withTranslation(), 'strict')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('只给词')
  })

  it('默认档位就是 strict——不传 policy 时也拒收', () => {
    expect(parsePrepResponse(withTranslation()).ok).toBe(false)
  })

  it('auto 档下接受 translation', () => {
    const r = parsePrepResponse(withTranslation(), 'auto')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.translation).toEqual(['The cat barred the door.'])
  })

  it('strict 档下没有 translation 时正常通过，且字段是 undefined 而不是空数组', () => {
    const r = parsePrepResponse(good(), 'strict')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.translation).toBeUndefined()
  })

  it('auto 档下 translation 形状不对要拒收', () => {
    expect(parsePrepResponse(withTranslation({ translation: 'not an array' }), 'auto').ok).toBe(false)
    expect(parsePrepResponse(withTranslation({ translation: [1, 2] }), 'auto').ok).toBe(false)
  })

  it('auto 档下条目字段里仍然不许出现整句英文——句子只能待在 translation 里', () => {
    const bad = JSON.stringify({
      genre: 'narrative', translation: ['ok'],
      targets: [goodTarget({ candidates: [goodCandidate({
        nuance: 'A palm-sized kitten had hemmed the neighbors in their own bedroom and waited.' })] })],
    })
    expect(parsePrepResponse(bad, 'auto').ok).toBe(false)
  })
})

describe('parseWordResponse —— 加词返回一条条目', () => {
  const good = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      zh: '编入', why_zh_is_precise: '强调写进去而不是说出来',
      flat_translation: { text: 'put into', why_it_dies: '太泛' },
      family: '把规则注入容器', no_single_word: false,
      candidates: [goodCandidate({ en: 'encode' })], ...over,
    })

  it('解析出一条，并打上「作者指定」的标记', () => {
    const r = parseWordResponse(good(), '编入')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.zh).toBe('编入')
    expect(r.value.byAuthor).toBe(true)
    expect(r.value.candidates.map((c) => c.en)).toEqual(['encode'])
  })

  it('优先级排最前——作者自己要的比模型捞的更该先看见', () => {
    const r = parseWordResponse(good(), '编入')
    expect(r.ok && r.value.priority).toBe(0)
  })

  it('模型给的 zh 跟作者划的不一致时，以作者划的为准', () => {
    const r = parseWordResponse(good({ zh: '' }), '编入三个 agents')
    expect(r.ok && r.value.zh).toBe('编入三个 agents')
  })

  it('候选的那套校验一条没少：缺短处的被丢掉', () => {
    const r = parseWordResponse(good({
      candidates: [goodCandidate({ en: '坏的', loses: '无' }), goodCandidate({ en: '好的' })],
    }), '编入')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.candidates.map((c) => c.en)).toEqual(['好的'])
    expect(r.warnings.length).toBe(1)
  })

  it('候选全不合格才算失败，并说明原因', () => {
    const r = parseWordResponse(good({ candidates: [goodCandidate({ loses: '无' })] }), '编入')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('编入')
  })

  it('不是 JSON 就拒收，不抛出', () => {
    expect(parseWordResponse('不是 JSON', '编入').ok).toBe(false)
  })
})
