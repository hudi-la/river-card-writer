import { describe, it, expect } from 'vitest'
import { pickFocusedTarget } from './focusTarget'
import type { Target } from './types'

const t = (zh: string): Target => ({
  zh, zhQuote: '', category: '动作质感', priority: 1, whyZhIsPrecise: '',
  flatTranslation: { text: '', whyItDies: '' },
  candidates: [{ en: 'x', verifyForm: 'x', register: '', nuance: '', whyFits: '', loses: '有短处' }],
  noSingleWord: false, family: '',
})

describe('pickFocusedTarget', () => {
  it('精确命中作者划的那个词', () => {
    expect(pickFocusedTarget([t('编入'), t('表现出来'), t('堵')], '编入')?.zh).toBe('编入')
  })

  it('模型一口气返回一堆时也只取一条——不该靠提示词保证的事在代码里保证', () => {
    const many = ['编入', '表现出来', '逐渐形成', '持续', '重复'].map(t)
    const picked = pickFocusedTarget(many, '表现出来')
    expect(picked?.zh).toBe('表现出来')
  })

  it('模型给的词形跟划的略有出入时也能对上', () => {
    expect(pickFocusedTarget([t('编入')], '编入三个 agents')?.zh).toBe('编入')
    expect(pickFocusedTarget([t('编入三个 agents')], '编入')?.zh).toBe('编入三个 agents')
  })

  it('实在对不上就取第一条，而不是一条都不给', () => {
    expect(pickFocusedTarget([t('甲'), t('乙')], '丙')?.zh).toBe('甲')
  })

  it('一条都没有就返回 null', () => {
    expect(pickFocusedTarget([], '编入')).toBeNull()
  })
})
