import { describe, it, expect, vi } from 'vitest'
import { runPrep, hasContent, PREP_CONCURRENCY } from './runPrep'
import type { PrepResult } from './types'
import type { Tier } from './verify'

function result(en: string): PrepResult {
  return {
    genre: 'narrative', genreReason: '',
    targets: [{
      zh: '堵', zhQuote: '', category: '动作质感', priority: 1, whyZhIsPrecise: '',
      flatTranslation: { text: '', whyItDies: '' },
      candidates: [{ en, verifyForm: en, register: '', nuance: '', whyFits: '', loses: '有缺点' }],
      noSingleWord: false, family: '',
    }],
  }
}

// Object.assign 而不是对象展开：展开会把 Partial 的宽类型盖上去、把 vi.fn 的
// Mock 类型冲掉，后面 .mock.calls 就取不到了。
function deps(over: Partial<Parameters<typeof runPrep>[1]> = {}) {
  const calls: string[] = []
  const base = {
    requestPrep: vi.fn(async (zh: string[]) => { calls.push(zh.join('')); return { ok: true as const, value: result(zh.join('')) } }),
    verify: vi.fn(async (forms: string[]) => new Map<string, Tier>(forms.map((f) => [f, 'ok' as Tier]))),
    onCardDone: vi.fn(),
    onTiers: vi.fn(),
    onProgress: vi.fn(),
    onError: vi.fn(),
  }
  const d = Object.assign(base, over)
  return { d, calls }
}

const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ cardId: `c${i}`, zhTexts: [`第${i}段`] }))

describe('hasContent', () => {
  it('只有空段落的卡不值得花一次调用', () => {
    expect(hasContent({ cardId: 'c', zhTexts: ['', '  '] })).toBe(false)
    expect(hasContent({ cardId: 'c', zhTexts: ['有字'] })).toBe(true)
  })
})

describe('runPrep', () => {
  it('每张卡一完成就交出去，不等整批——边栏边跑边长内容', async () => {
    const { d } = deps()
    await runPrep(cards(2), d)
    expect(d.onCardDone).toHaveBeenCalledTimes(2)
    expect(d.onCardDone.mock.calls[0][0]).toBe('c0')
  })

  it('并发跑，不串行——一批里的请求同时发出', async () => {
    let inFlight = 0
    let peak = 0
    const { d } = deps({
      requestPrep: vi.fn(async (zh: string[]) => {
        inFlight++; peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return { ok: true as const, value: result(zh.join('')) }
      }),
    })
    await runPrep(cards(PREP_CONCURRENCY), d)
    expect(peak).toBe(PREP_CONCURRENCY)
  })

  it('一批的所有词形一次查完，不按卡分开查', async () => {
    const { d } = deps()
    await runPrep(cards(PREP_CONCURRENCY), d)
    expect(d.verify).toHaveBeenCalledTimes(1)
    expect(d.verify.mock.calls[0][0].length).toBe(PREP_CONCURRENCY)
  })

  it('报告进度，从 0 开始', async () => {
    const { d } = deps()
    await runPrep(cards(2), d)
    expect(d.onProgress.mock.calls[0]).toEqual([0, 2])
    const last = d.onProgress.mock.calls[d.onProgress.mock.calls.length - 1]
    expect(last).toEqual([2, 2])
  })

  it('某张卡失败不拖垮整批，报错之后继续', async () => {
    let n = 0
    const { d } = deps({
      requestPrep: vi.fn(async (zh: string[]) => {
        n++
        if (n === 1) return { ok: false as const, error: '模型 503' }
        return { ok: true as const, value: result(zh.join('')) }
      }),
    })
    const out = await runPrep(cards(3), d)
    expect(out.failed).toBe(1)
    expect(out.done).toBe(2)
    expect(d.onError).toHaveBeenCalledTimes(1)
  })

  it('按「停」之后不再发新请求', async () => {
    let stop = false
    const { d } = deps({ shouldStop: () => stop })
    const many = cards(PREP_CONCURRENCY * 3)
    // 第一批做完就喊停
    d.onProgress = vi.fn((done: number) => { if (done >= PREP_CONCURRENCY) stop = true })
    const out = await runPrep(many, d)
    expect(out.stopped).toBe(true)
    expect(d.requestPrep).toHaveBeenCalledTimes(PREP_CONCURRENCY)
  })

  it('全部失败时也不抛出，如实报数', async () => {
    const { d } = deps({ requestPrep: vi.fn(async () => ({ ok: false as const, error: '全挂' })) })
    const out = await runPrep(cards(2), d)
    expect(out).toEqual({ done: 0, failed: 2, stopped: false })
    expect(d.verify).not.toHaveBeenCalled()
  })

  it('查证挂掉不中断整章——无徽章 > 整章死在半路', async () => {
    const { d } = deps({ verify: vi.fn(async () => { throw new Error('CORS') }) })
    const out = await runPrep(cards(PREP_CONCURRENCY * 2), d)
    // 每一批的查证都挂了，但每张卡的提词照样落地、循环跑到底
    expect(out.done).toBe(PREP_CONCURRENCY * 2)
    expect(out.stopped).toBe(false)
    expect(d.onCardDone).toHaveBeenCalledTimes(PREP_CONCURRENCY * 2)
    expect(d.onTiers).not.toHaveBeenCalled()
  })
})
