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
  render(<PrepSidebar targets={targets} genre="narrative" tiers={tiers} {...over} />)

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

  it('表头只有一行：标题在左、文体条数在右', () => {
    const { container } = sidebar()
    const heads = container.querySelectorAll('header')
    expect(heads.length).toBe(1)
    expect(heads[0].textContent).toContain('备料 · 当前这张卡')
    expect(heads[0].textContent).toContain('叙事 · 1 条')
  })

  it('档位标记不在边栏——它属于顶栏，贴着稿子本身', () => {
    expect(sidebar().container.querySelector('[data-ai-policy]')).toBeNull()
  })

  it('空态里给「备这张卡」——那是这张卡的动作，就该待在这张卡的面板里', () => {
    const onPrepCard = () => {}
    const { container } = sidebar({ targets: [], onPrepCard })
    expect(container.querySelector('.prep-card-btn')?.textContent).toBe('备这张卡')
  })

  it('有内容时表头给一个轻量的「重备」，不占主按钮的位置', () => {
    const { container } = sidebar({ onPrepCard: () => {} })
    expect(container.querySelector('.prep-redo')?.textContent).toBe('重备')
  })

  it('还没备料时给一句说明，不是空白', () => {
    const { container } = sidebar({ targets: [] })
    expect(container.textContent).toContain('句子由你自己写')
  })

  it('备料中显示进行态，不显示"0 条"', () => {
    const { container } = sidebar({ targets: [], busy: true })
    expect(container.textContent).toContain('备料中')
    expect(container.textContent).not.toContain('0 条')
  })

  it('前两条展开，其余折成一行——一张卡五六条全展开边栏就是一堵墙', () => {
    const many = [0, 1, 2, 3].map((i) => ({ ...targets[0], zh: `靶心${i}` }))
    const { container } = sidebar({ targets: many })
    expect(container.querySelectorAll('section.prep-target').length).toBe(2)
    expect(container.querySelectorAll('details.prep-collapsed').length).toBe(2)
    // 展开的是前两条（priority 已排序，承重句和歧义那类排最前）
    const expanded = Array.from(container.querySelectorAll('section.prep-target .prep-zh'))
    expect(expanded.map((n) => n.textContent?.slice(0, 3))).toEqual(['靶心0', '靶心1'])
  })

  it('折叠行上仍然看得见候选词和它们的查证档位', () => {
    const many = [0, 1, 2].map((i) => ({ ...targets[0], zh: `靶心${i}` }))
    const { container } = sidebar({ targets: many })
    const chips = container.querySelectorAll('details.prep-collapsed .prep-chip')
    expect(chips.length).toBe(3)
    expect(Array.from(chips).map((c) => c.getAttribute('data-tier'))).toEqual(['ok', 'rare', 'unverified'])
  })

  it('边栏有标题，说明它显示的是哪一张卡的备料', () => {
    expect(sidebar().container.textContent).toContain('备料 · 当前这张卡')
  })

  it('靶心少于展开上限时不出现任何折叠行', () => {
    const { container } = sidebar({ targets: [targets[0]] })
    expect(container.querySelectorAll('details.prep-collapsed').length).toBe(0)
  })

  it('英文没有对应单词时明说出来', () => {
    const { container } = sidebar({ targets: [{ ...targets[0], noSingleWord: true }] })
    expect(container.textContent).toContain('英文没有对应单词')
  })
})
