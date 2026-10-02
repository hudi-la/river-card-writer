import { describe, it, expect, vi } from 'vitest'
import { tierOf, headWord, createVerifier, migrateTier } from './verify'

describe('headWord', () => {
  it('取短语的第一个词', () => {
    expect(headWord('enmeshed within it')).toBe('enmeshed')
    expect(headWord('operationalized as independent actors')).toBe('operationalized')
    expect(headWord('strut')).toBe('strut')
  })
})

describe('tierOf —— 只回答"有没有人这么用过"', () => {
  it('查到就是查到，不管频率多低', () => {
    // 2026-10-02 砍掉了「罕用」那一档。学术和文学写作里精确的词往往就是低频的
    // 词（operationalized、enmeshed、self-effacement），给它们挂警告标签等于
    // 在惩罚精确。
    expect(tierOf(5.7e-7)).toBe('found')
    expect(tierOf(1.5e-9)).toBe('found') // swat down，确实少见但确实是英文
    expect(tierOf(6.8e-11)).toBe('found')
  })

  it('整体没查到但词本身有 → collocation-unseen', () => {
    // enmeshed within it 整体查不到，enmeshed 本身 7.9e-07
    expect(tierOf(null, 7.9e-7)).toBe('collocation-unseen')
    expect(tierOf(0, 7.9e-7)).toBe('collocation-unseen')
  })

  it('这一档不能并进 found——对"造搭配"最敏感的恰恰是它', () => {
    // pace the beat：pace 很常见，但那个词组是模型造的（英文说的是 walk the beat）
    expect(tierOf(null, 1e-5)).not.toBe('found')
  })

  it('两个都没查到才是 not-found', () => {
    expect(tierOf(null, null)).toBe('not-found')
    expect(tierOf(null)).toBe('not-found')
  })

  it('查不到绝不默认当成查到了——这一层的全部价值就在于不放过造出来的词', () => {
    expect(tierOf(null)).not.toBe('found')
  })
})

describe('createVerifier', () => {
  // 取数是批量的，而且必须在服务端做：Ngrams 端点不返回 CORS 头，浏览器直连
  // 会被拦掉，那会让每个词都变成"未查证"、徽章沦为纯噪音。
  const FREQS: Record<string, number | null> = { 'pin down': 5.7e-7, 'swat down': 1.5e-9 }
  // 服务端现在给 { full, head } 一对；这里词头一律给 null，专测整体那一路。
  const fakeBatch = (forms: string[]) =>
    Object.fromEntries(forms.map((f) => [f, { full: FREQS[f] ?? null, head: null }]))

  it('把每个词形映射到它的档位', async () => {
    const verify = createVerifier(async (forms) => fakeBatch(forms))
    const m = await verify(['pin down', 'swat down', 'cerebral haughtiness'])
    expect(m.get('pin down')).toBe('found')
    expect(m.get('swat down')).toBe('found') // 少见但确实是英文，不该被警告
    // 这个是模型真造出来的词，语料里一点痕迹都没有
    expect(m.get('cerebral haughtiness')).toBe('not-found')
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
    expect(m.get('anything')).toBe('not-found')
    expect(m.get('else')).toBe('not-found')
  })

  it('整批失败不写缓存——下次还要再试，免得一次网络抖动把一整批好词永久钉住', async () => {
    let calls = 0
    const flaky = vi.fn(async (forms: string[]) => {
      calls++
      if (calls === 1) throw new Error('down')
      return fakeBatch(forms)
    })
    const verify = createVerifier(flaky)
    expect((await verify(['pin down'])).get('pin down')).toBe('not-found')
    expect((await verify(['pin down'])).get('pin down')).toBe('found')
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

  it('能用持久化读回来的档位预热——查过的词刷新后也不用再查', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy, { 'pin down': 'found', 'swat down': 'found' })
    const m = await verify(['pin down', 'swat down'])
    expect(spy).not.toHaveBeenCalled()
    expect(m.get('pin down')).toBe('found')
  })

  it('预热里没有的词照常去查', async () => {
    const spy = vi.fn(async (forms: string[]) => fakeBatch(forms))
    const verify = createVerifier(spy, { 'pin down': 'found' })
    await verify(['pin down', 'swat down'])
    expect(spy.mock.calls[0][0]).toEqual(['swat down'])
  })

  it('旧形状（只给一个数）也认——服务端没来得及升级时不至于全军覆没', async () => {
    const verify = createVerifier(async (forms) => Object.fromEntries(forms.map((f) => [f, 5.7e-7])))
    expect((await verify(['pin down'])).get('pin down')).toBe('found')
  })

  it('服务端给了词头频率时，整体少见的词形落到 head-only', async () => {
    const verify = createVerifier(async () => ({ 'enmeshed within it': { full: null, head: 7.9e-7 } }))
    expect((await verify(['enmeshed within it'])).get('enmeshed within it')).toBe('collocation-unseen')
  })

  it('旧持久化里的档位名就地迁移——不为几个旧值写数据库迁移', () => {
    expect(migrateTier('ok')).toBe('found')
    // 「罕用」本来就是查到了，只是频率低——那不该是个警告
    expect(migrateTier('rare')).toBe('found')
    expect(migrateTier('head-only')).toBe('collocation-unseen')
    expect(migrateTier('unverified')).toBe('not-found')
    expect(migrateTier('found')).toBe('found')
    expect(migrateTier('啥也不是')).toBe('not-found')
  })
})
