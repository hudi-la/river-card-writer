import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PrepSidebar } from './PrepSidebar'
import type { Target } from '../prep/types'
import type { Tier } from '../prep/verify'

const targets: Target[] = [{
  zh: '堵', zhQuote: '堵在卧室里', category: '动作质感', priority: 1,
  whyZhIsPrecise: '强弱易位的攻防态势',
  flatTranslation: { text: 'block', whyItDies: '像一块没生命的石头' },
  candidates: [
    { en: 'hem in', verifyForm: 'hem in', register: '书面', nuance: '围困', whyFits: '贴', loses: '没有对峙感' },
    { en: 'swat down', verifyForm: 'swat down', register: '口语', nuance: '猛击', whyFits: '轻蔑', loses: '没有制服的重量' },
    { en: 'corner off', verifyForm: 'corner off', register: '口语', nuance: '围角', whyFits: '也许', loses: '不地道' },
  ],
  noSingleWord: false, family: '剥夺退路的掌控',
}]
const tiers = new Map<string, Tier>([['hem in', 'ok'], ['swat down', 'rare'], ['corner off', 'unverified']])

const sidebar = (over: Partial<Parameters<typeof PrepSidebar>[0]> = {}) =>
  render(<PrepSidebar targets={targets} genre="narrative" tiers={tiers} aiPolicy="strict" {...over} />)

describe('PrepSidebar', () => {
  it('显示靶心、族、中文准在哪、以及笼统译法的对照', () => {
    const { container } = sidebar()
    expect(container.textContent).toContain('堵')
    expect(container.textContent).toContain('剥夺退路的掌控')
    expect(container.textContent).toContain('强弱易位的攻防态势')
    expect(container.textContent).toContain('block')
    expect(container.textContent).toContain('像一块没生命的石头')
  })

  it('每个候选都显示它丢了什么——没有任何候选只有优点', () => {
    const { container } = sidebar()
    expect(container.textContent).toContain('没有对峙感')
    expect(container.textContent).toContain('没有制服的重量')
    expect(container.textContent).toContain('不地道')
  })

  it('三档徽章各自可辨，未查证的那个明确说自己没有背书', () => {
    const { container } = sidebar()
    const badges = container.querySelectorAll('.prep-tier[data-tier]')
    expect(Array.from(badges).map((b) => b.getAttribute('data-tier'))).toEqual(['ok', 'rare', 'unverified'])
    expect(container.textContent).toContain('未查证')
    expect(container.textContent).toContain('语料里查不到')
    expect(container.textContent).toContain('罕用')
  })

  it('查证结果里没有这个词形时，保守地当未查证——绝不默认当成已查证', () => {
    const { container } = sidebar({ tiers: new Map() })
    const badges = container.querySelectorAll('.prep-tier[data-tier]')
    expect(Array.from(badges).every((b) => b.getAttribute('data-tier') === 'unverified')).toBe(true)
  })

  it('aiPolicy 一直看得见——这个开关设错了不会报错，只能靠让状态在眼前来防', () => {
    const { container } = sidebar()
    expect(container.querySelector('[data-ai-policy="strict"]')).not.toBeNull()
    expect(container.textContent).toContain('只给词')
  })

  it('换成 open / auto 档时标记跟着变', () => {
    expect(sidebar({ aiPolicy: 'open' }).container.textContent).toContain('加骨架')
    expect(sidebar({ aiPolicy: 'auto' }).container.textContent).toContain('给译文')
  })

  it('还没备料时给一句说明，不是空白', () => {
    const { container } = sidebar({ targets: [] })
    expect(container.textContent).toContain('备料')
    expect(container.textContent).toContain('句子由你自己写')
  })

  it('备料中显示进行态，不显示"0 条"', () => {
    const { container } = sidebar({ targets: [], busy: true })
    expect(container.textContent).toContain('备料中')
    expect(container.textContent).not.toContain('0 条')
  })

  it('英文没有对应单词时明说出来', () => {
    const { container } = sidebar({ targets: [{ ...targets[0], noSingleWord: true }] })
    expect(container.textContent).toContain('英文没有对应单词')
  })
})
