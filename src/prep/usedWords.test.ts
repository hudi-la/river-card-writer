import { describe, it, expect } from 'vitest'
import { usedCandidates, mergeUsed } from './usedWords'
import type { Target } from './types'

function target(...ens: string[]): Target {
  return {
    zh: '堵', zhQuote: '', category: '动作质感', priority: 1, whyZhIsPrecise: '',
    flatTranslation: { text: '', whyItDies: '' },
    candidates: ens.map((en) => ({ en, verifyForm: en, register: '', nuance: '', whyFits: '', loses: '有短处' })),
    noSingleWord: false, family: '',
  }
}

describe('usedCandidates', () => {
  it('找出确认文本里真正用上的候选', () => {
    const r = usedCandidates([target('hem in', 'bar the door', 'trap')], 'The cat trapped them — it would hem in anyone.')
    expect(r.sort()).toEqual(['hem in'])
  })

  it('忽略大小写', () => {
    expect(usedCandidates([target('Strut')], 'it would strut around')).toEqual(['strut'])
  })

  it('按词边界匹配，不把 pin 算进 pinned 之外的词里', () => {
    // cornered 里含 corner，但那是不同的形态，不该算
    expect(usedCandidates([target('corner')], 'it cornered them')).toEqual([])
    expect(usedCandidates([target('corner')], 'it would corner them')).toEqual(['corner'])
  })

  it('标点不影响匹配', () => {
    expect(usedCandidates([target('pin down')], 'ready to pin down, at last.')).toEqual(['pin down'])
  })

  it('没用上就不记——确认是作者的选择，不是我们替他猜', () => {
    expect(usedCandidates([target('hem in', 'trap')], 'It blocked the doorway.')).toEqual([])
  })

  it('多条靶心一起看', () => {
    const r = usedCandidates([target('hem in'), target('strut')], 'it would hem in and strut')
    expect(r.sort()).toEqual(['hem in', 'strut'])
  })
})

describe('mergeUsed', () => {
  it('累计次数——用得越多越说明那是作者的词，不是一次偶然', () => {
    let m = mergeUsed(undefined, ['strut'])
    expect(m).toEqual({ strut: 1 })
    m = mergeUsed(m, ['strut', 'prowl'])
    expect(m).toEqual({ strut: 2, prowl: 1 })
  })

  it('空输入不动原数据', () => {
    expect(mergeUsed({ strut: 3 }, [])).toEqual({ strut: 3 })
  })
})
