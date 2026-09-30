import { describe, it, expect, vi } from 'vitest'
import { tierOf, createVerifier, RARE_BELOW } from './verify'

describe('tierOf', () => {
  it('查不到（null）一律是 unverified，绝不默认当成已查证', () => {
    expect(tierOf(null)).toBe('unverified')
  })
  it('频率够高是 ok（用的是实测到的真实频率）', () => {
    expect(tierOf(5.7e-7)).toBe('ok') // pin down
    expect(tierOf(7.1e-8)).toBe('ok') // hem in
    expect(tierOf(9.5e-7)).toBe('ok') // strut
  })
  it('频率极低是 rare——真实存在但很少见，标出来但不删', () => {
    expect(tierOf(1.5e-9)).toBe('rare') // swat down
  })
  it('门槛边界：恰好等于门槛算 ok', () => {
    expect(tierOf(RARE_BELOW)).toBe('ok')
    expect(tierOf(RARE_BELOW - 1e-12)).toBe('rare')
  })
  it('0 算 rare 而不是 unverified——查到了，只是极少', () => {
    expect(tierOf(0)).toBe('rare')
  })
})

describe('createVerifier', () => {
  // 取数是批量的，而且必须在服务端做：Ngrams 端点不返回 CORS 头，浏览器直连
  // 会被拦掉，那会让每个词都变成"未查证"、徽章沦为纯噪音。
  const FREQS: Record<string, number | null> = { 'pin down': 5.7e-7, 'swat down': 1.5e-9 }
  const fakeBatch = (forms: string[]) =>
    Object.fromEntries(forms.map((f) => [f, FREQS[f] ?? null]))

  it('把每个词形映射到它的档位', async () => {
    const verify = createVerifier(async (forms) => fakeBatch(forms))
    const m = await verify(['pin down', 'swat down', 'cerebral haughtiness'])
    expect(m.get('pin down')).toBe('ok')
    expect(m.get('swat down')).toBe('rare')
    // 这个就是模型真的造出来的那个词
    expect(m.get('cerebral haughtiness')).toBe('unverified')
  })

  it('一批只发一次请求，重复词形去重', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy)
    await verify(['strut', 'strut', 'pin down'])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].sort()).toEqual(['pin down', 'strut'])
  })

  it('跨调用也缓存——一个词的历史语料频率不会变', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy)
    await verify(['pin down'])
    await verify(['pin down'])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('已缓存的词不再进下一批请求', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy)
    await verify(['pin down'])
    await verify(['pin down', 'swat down'])
    expect(spy.mock.calls[1][0]).toEqual(['swat down'])
  })

  it('整批取数抛异常时全降级成 unverified，绝不让整次备料失败', async () => {
    const verify = createVerifier(async () => { throw new Error('CORS blocked') })
    const m = await verify(['anything', 'else'])
    expect(m.get('anything')).toBe('unverified')
    expect(m.get('else')).toBe('unverified')
  })

  it('整批失败不写缓存——下次还要再试，免得一次网络抖动把一整批好词永久钉住', async () => {
    let calls = 0
    const flaky = vi.fn(async (forms: string[]) => {
      calls++
      if (calls === 1) throw new Error('down')
      return fakeBatch(forms)
    })
    const verify = createVerifier(flaky)
    expect((await verify(['pin down'])).get('pin down')).toBe('unverified')
    expect((await verify(['pin down'])).get('pin down')).toBe('ok')
  })

  it('服务端明确说"没查到"（返回 null）是可缓存的结论，不再重查', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy)
    await verify(['cerebral haughtiness'])
    await verify(['cerebral haughtiness'])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('空词形被忽略，不发请求', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy)
    const m = await verify(['', '   '])
    expect(spy).not.toHaveBeenCalled()
    expect(m.size).toBe(0)
  })
})
