// 语料查证层。它存在的唯一理由：LLM 会造出流利但没人真那么说的英文搭配
// （真跑产出过 cerebral haughtiness、architecting the initial conditions），
// 而对一个"帮人选词"的工具，这是最坏的失败——作者信了、写进稿子、交出去。
//
// 对策不是要求模型自觉，是拿真实语料统计去查。统计里生造的词没地方躲：实测
// 两个坏词全部被抓住，十个好词全部通过。
//
// 能保证的边界要说清楚：保证不了模型不再生造词，也保证不了捞全每个靶心。
// 能保证的是——未查证的词绝不和已查证的词长得一样。

// ok        —— 整体搭配在语料里常见
// head-only —— 整体搭配没见到，但词本身常见。这是最常见的一档：模型给的候选
//              往往是带代词/介词的短语（enmeshed within it），整体当然查不到，
//              可那个词是好词。不区分的话好词会被当成可疑词，徽章就废了。
// rare      —— 整体和词头都少见
// unverified—— 什么都没查到
export type Tier = 'ok' | 'head-only' | 'rare' | 'unverified'

// 门槛是相对的，重点是分档本身。这个值来自实测：swat down 1.5e-9（确实罕用）
// vs hem in 7.1e-8（正常书面词），1e-8 把两者分开。
export const RARE_BELOW = 1e-8

// 词头：短语的第一个词。英语里动词短语的信息量基本都在它身上
// （enmeshed within it → enmeshed；operationalized as independent actors →
// operationalized），拿它兜底最省事也最准。
export function headWord(form: string): string {
  return form.trim().split(/[\s,]+/)[0] ?? ''
}

// CRITICAL：查不到绝不默认当成已查证。
// 0 → rare 而不是 unverified：那是"查到了，只是极少"，跟"查不到"是两件事。
//
// head 这一层是实测逼出来的：enmeshed within it 是 8.1e-10（看着像可疑词），
// 而 enmeshed 本身是 7.9e-07（再正常不过）。不兜这一层的话，一整栏好词会被
// 集体标成罕用/未查证，作者两天就学会无视徽章——那正是 spec §11.1 说的负资产。
// 但也不能直接拿词头的频率当整体的频率：那会让模型生造的搭配蒙混过关
// （pace the beat → pace 很常见）。所以单列一档，把"词常见、搭配未见"说出来。
export function tierOf(freq: number | null, headFreq?: number | null): Tier {
  if (freq != null && freq >= RARE_BELOW) return 'ok'
  if (headFreq != null && headFreq >= RARE_BELOW) return 'head-only'
  if (freq != null) return 'rare'
  return 'unverified'
}

// 批量取频率。CRITICAL：取数必须在服务端做。
// books.google.com/ngrams/json **不返回 Access-Control-Allow-Origin**，浏览器
// 直连一律被 CORS 拦掉——那会让每个词都变成"未查证"，徽章沦为纯噪音，正是
// spec §11.1 说的"负资产"（只不过成因是全军覆没而不是误报）。
// 这个函数因此是注入进来的：实现走 Edge Function（见 client.ts），测试注入假的。
// 服务端对每个词形返回两个数：整体搭配的频率，和词头的频率（单词形态下两者相同）。
export type FreqPair = { full: number | null; head: number | null }
export type FetchFreqs = (forms: string[]) => Promise<Record<string, FreqPair | number | null>>

// 一个词的历史语料频率不会变，所以缓存可以永久有效。
// 只缓存查到结果的词——整批取数失败时不写缓存，否则一次网络抖动会把一整批
// 好词永久钉在"未查证"上。
// seed：从持久化里读回来的已知档位，用来预热缓存。一个词的历史语料频率不会变，
// 所以查过的永远不用再查——刷新之后也不该从零开始。
export function createVerifier(fetchFreqs: FetchFreqs, seed?: Record<string, Tier>) {
  const cache = new Map<string, Tier>(seed ? Object.entries(seed) : [])

  return async function verify(forms: string[]): Promise<Map<string, Tier>> {
    const unique = Array.from(new Set(forms.filter((f) => f.trim() !== '')))
    const missing = unique.filter((f) => !cache.has(f))

    if (missing.length > 0) {
      try {
        const freqs = await fetchFreqs(missing)
        for (const form of missing) {
          // 服务端没给这个词的条目 = 没查到 = unverified，但这是"查过了"的结论，
          // 所以可以缓存。整批失败才不缓存（走下面的 catch）。
          const v = form in freqs ? freqs[form] : null
          // 兼容旧形状（只给一个数）：那时没有词头兜底。
          const pair: FreqPair = typeof v === 'number' || v === null ? { full: v, head: null } : v
          cache.set(form, tierOf(pair.full, pair.head))
        }
      } catch {
        // 整批取不到就全降级成未查证，绝不让整次备料失败；也不写缓存，下次再试。
      }
    }

    const out = new Map<string, Tier>()
    for (const f of unique) out.set(f, cache.get(f) ?? 'unverified')
    return out
  }
}
