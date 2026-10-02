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

  it('档位状态在边栏里，一直看得见——这个开关设错了不会报错', () => {
    const { container } = sidebar()
    expect(container.querySelector('[data-ai-policy="strict"]')).not.toBeNull()
    expect(container.textContent).toContain('只给词')
    expect(container.textContent).toContain('句子归你')
  })

  it('换档时说明跟着变', () => {
    expect(sidebar().container.textContent).toContain('句子归你')
    expect(sidebar({ aiPolicy: 'auto' }).container.textContent).toContain('只在这里当参考')
  })

  it('给了 onPolicyChange 就是真开关，两档都能点', () => {
    const picked: string[] = []
    const { container } = sidebar({ onPolicyChange: (p) => picked.push(p) })
    const btns = container.querySelectorAll('.policy-switch button')
    expect(Array.from(btns).map((b) => b.textContent)).toEqual(['只给词', '给译文'])
    ;(btns[1] as HTMLButtonElement).click()
    expect(picked).toEqual(['auto'])
  })

  it('当前档位在开关上标出来，读屏也能知道', () => {
    const { container } = sidebar({ aiPolicy: 'auto', onPolicyChange: () => {} })
    const on = container.querySelector('.policy-switch button[data-on]')
    expect(on?.textContent).toBe('给译文')
    expect(on?.getAttribute('aria-pressed')).toBe('true')
  })

  it('auto 档显示整句译文，并说明它不会进英文栏', () => {
    const { container } = sidebar({ aiPolicy: 'auto', translation: ['The cat barred the door.'] })
    expect(container.querySelector('.prep-translation')?.textContent).toContain('The cat barred the door.')
    expect(container.textContent).toContain('不会进你的英文栏')
  })

  it('strict 档就算手里有译文也不显示——档位说了算', () => {
    const { container } = sidebar({ aiPolicy: 'strict', translation: ['The cat barred the door.'] })
    expect(container.querySelector('.prep-translation')).toBeNull()
    expect(container.textContent).not.toContain('The cat barred the door.')
  })

  it('有 onClose 时给一个 × 可以关掉这一栏，名字跟顶栏那个开关区分开', () => {
    const { container } = sidebar({ onClose: () => {} })
    const close = container.querySelector('.prep-close')
    expect(close).not.toBeNull()
    // 顶栏的面板开关叫「收起备料」；两个控件不该撞同一个无障碍名称
    expect(close!.getAttribute('aria-label')).toBe('关闭备料栏')
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

  it('每一条都可折叠——同一种东西就该有同一种行为', () => {
    const many = [0, 1, 2, 3].map((i) => ({ ...targets[0], zh: `靶心${i}` }))
    const { container } = sidebar({ targets: many })
    const all = container.querySelectorAll('details.prep-target')
    expect(all.length).toBe(4)
    // 每一条都有可点的 summary，包括前两条（原来前两条是固定展开的 section，没有入口）
    expect(Array.from(all).every((d) => d.querySelector('summary'))).toBe(true)
  })

  it('全部默认折起——要看哪条点哪条', () => {
    const many = [0, 1, 2, 3].map((i) => ({ ...targets[0], zh: `靶心${i}` }))
    const { container } = sidebar({ targets: many })
    const open = Array.from(container.querySelectorAll('details.prep-target')).map(
      (d) => (d as HTMLDetailsElement).open
    )
    expect(open).toEqual([false, false, false, false])
  })

  it('折起来时标题行上仍然看得见靶心名，扫一眼就知道这张卡有哪些东西', () => {
    const { container } = sidebar()
    expect(container.querySelector('details.prep-target summary .prep-zh')?.textContent).toBe('堵')
  })

  it('折叠状态下标题行上仍然看得见候选词和它们的查证档位', () => {
    const many = [0, 1, 2].map((i) => ({ ...targets[0], zh: `靶心${i}` }))
    const { container } = sidebar({ targets: many })
    const chips = container.querySelectorAll('details.prep-target summary .prep-chip')
    expect(chips.length).toBe(9) // 三条靶心各三个候选
    expect(Array.from(chips).slice(0, 3).map((c) => c.getAttribute('data-tier'))).toEqual([
      'ok', 'rare', 'unverified',
    ])
  })

  it('边栏有标题，说明它显示的是哪一张卡的备料', () => {
    expect(sidebar().container.textContent).toContain('备料 · 当前这张卡')
  })

  it('失败留在边栏里，说清原因并给再试一次——不是闪一下就没的 toast', () => {
    const { container } = sidebar({ targets: [], error: '所有候选模型都没答上来（最后一次 503）', onPrepCard: () => {} })
    expect(container.querySelector('.prep-error')).not.toBeNull()
    expect(container.textContent).toContain('上一次备料没成')
    expect(container.textContent).toContain('503')
    expect(container.querySelector('.prep-error .prep-card-btn')?.textContent).toBe('再试一次')
  })

  it('有错误时不再显示"还没备料"——失败和从没试过必须长得不一样', () => {
    const { container } = sidebar({ targets: [], error: '炸了' })
    expect(container.textContent).not.toContain('这张卡还没备料')
  })

  it('被丢掉的候选折起来告诉作者，否则他会以为模型就只给了这么点', () => {
    const { container } = sidebar({ warnings: ['第 1 条靶心：候选「x」没说它丢了什么，已丢弃'] })
    expect(container.querySelector('.prep-warnings')?.textContent).toContain('有 1 条被丢掉了')
  })

  it('备料中不显示上一次的错误——那是正在发生的事，不是历史', () => {
    const { container } = sidebar({ targets: [], error: '炸了', busy: true })
    expect(container.querySelector('.prep-error')).toBeNull()
  })

  it('英文没有对应单词时明说出来', () => {
    const { container } = sidebar({ targets: [{ ...targets[0], noSingleWord: true }] })
    expect(container.textContent).toContain('英文没有对应单词')
  })

  it('「词常见 · 搭配未见」这一档不打删除线——词本身没问题，别冤枉它', () => {
    const tiersHead = new Map<string, Tier>([['hem in', 'head-only']])
    const { container } = sidebar({ tiers: tiersHead })
    expect(container.querySelector('.prep-tier[data-tier="head-only"]')?.textContent).toBe('词常见 · 搭配未见')
  })
})
