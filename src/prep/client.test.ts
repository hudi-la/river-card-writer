import { describe, it, expect, vi } from 'vitest'
import { requestPrep, requestTranslation, requestWord, makeFetchFreqs } from './client'

const validResponse = JSON.stringify({
  genre: 'narrative',
  genre_reason: '动作细节多',
  targets: [{
    zh: '堵', zh_quote: '堵在卧室里', category: '动作质感', priority: 1,
    why_zh_is_precise: '强弱易位', flat_translation: { text: 'block', why_it_dies: '没生命' },
    candidates: [{ en: 'hem in', verify_form: 'hem in', register: '书面', nuance: '围困', why_fits: '贴', loses: '没对峙感' }],
    no_single_word: false, family: '剥夺退路的掌控',
  }],
})

describe('requestPrep', () => {
  it('把校验过的结果交回来，并且请求里带 kind: model', async () => {
    const invoke = vi.fn(async (_n: string, _o: { body: unknown }) => ({ data: { text: validResponse } as any, error: null }))
    const r = await requestPrep(['第一段'], { invoke })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.targets[0].zh).toBe('堵')
    expect((invoke.mock.calls[0][1] as any).body.kind).toBe('model')
  })

  it('Edge Function 报错时返回失败，不抛出', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: '没登录' } }))
    const r = await requestPrep(['第一段'], { invoke })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('没登录')
  })

  it('服务端在 200 里带 error 字段时也算失败', async () => {
    const invoke = vi.fn(async () => ({ data: { error: '服务端没有配置 GEMINI_API_KEY' }, error: null }))
    const r = await requestPrep(['第一段'], { invoke })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('GEMINI_API_KEY')
  })

  it('模型返回值过不了校验时返回失败', async () => {
    const invoke = vi.fn(async () => ({ data: { text: JSON.stringify({ genre: 'narrative', targets: [] }) }, error: null }))
    expect((await requestPrep(['第一段'], { invoke })).ok).toBe(false)
  })

  it('网络整体抛异常时也返回失败', async () => {
    const invoke = vi.fn(async () => { throw new Error('offline') })
    const r = await requestPrep(['第一段'], { invoke })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('offline')
  })
})

describe('makeFetchFreqs', () => {
  it('把词形批量发给 Edge Function，带 kind: ngram', async () => {
    const invoke = vi.fn(async (_n: string, _o: { body: unknown }) => ({ data: { freqs: { 'hem in': 7.1e-8 } } as any, error: null }))
    const fetchFreqs = makeFetchFreqs({ invoke })
    const out = await fetchFreqs(['hem in'])
    expect(out['hem in']).toBe(7.1e-8)
    expect((invoke.mock.calls[0][1] as any).body).toEqual({ kind: 'ngram', forms: ['hem in'] })
  })

  it('刻意抛出而不是静默返回空——createVerifier 接到异常才会整批降级且不写缓存', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: 'CORS blocked' } }))
    await expect(makeFetchFreqs({ invoke })(['strut'])).rejects.toThrow('CORS blocked')
  })
})


describe('requestTranslation', () => {
  it('送的是翻译提示词，交回每段一句', async () => {
    const seen: any[] = []
    const invoke = vi.fn(async (_n: string, o: { body: any }) => {
      seen.push(o.body)
      return { data: { text: JSON.stringify({ translation: ['A.', 'B.'] }) } as any, error: null }
    })
    const r = await requestTranslation(['第一段', '第二段'], { invoke })
    expect(r).toEqual({ ok: true, value: ['A.', 'B.'] })
    expect(seen[0].kind).toBe('model')
    expect(seen[0].system).not.toContain('靶心')
  })

  it('服务端出错时不抛，交回错误', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: '挂了' } }))
    expect(await requestTranslation(['x'], { invoke })).toEqual({ ok: false, error: '挂了' })
  })
})

describe('requestWord', () => {
  const ok = JSON.stringify({
    zh: '编入', why_zh_is_precise: '写进去',
    flat_translation: { text: 'put into', why_it_dies: '太泛' },
    family: '注入', no_single_word: false,
    candidates: [{ en: 'encode', verify_form: 'encode', register: '技术', nuance: '编码', why_fits: '贴', loses: '偏机械' }],
  })

  it('发的是加词的提示词，不是备料那一份', async () => {
    const seen: string[] = []
    const invoke = vi.fn(async (_n: string, o: { body: any }) => {
      seen.push(o.body.system)
      return { data: { text: ok } as any, error: null }
    })
    const r = await requestWord(['第一段'], '编入', { invoke })
    expect(r.ok).toBe(true)
    expect(seen[0]).not.toContain('靶心')
    expect(seen[0]).toContain('这个词用哪个英文好')
  })

  it('失败不抛出', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: '没登录' } }))
    const r = await requestWord(['x'], '编入', { invoke })
    expect(r.ok).toBe(false)
  })
})
