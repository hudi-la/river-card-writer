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
// 查证只回答一件事：**这个词组在真实英文里有没有人用过。**
//
// 2026-10-02 砍掉了频率判断。原来还有一档「罕用」（频率低于 1e-8），那是个
// 方向错误的设计：学术和文学写作里，**精确的词往往就是低频的词**——
// operationalized、enmeshed、self-effacement 全都不常见，全都是对的。给它们
// 挂一个像警告的标签，等于在惩罚精确。
//
// 这一层存在的唯一理由是 LLM 会造词（真造过 cerebral haughtiness、
// architecting the initial conditions、pace the beat）。那类词读起来很顺，
// 作者信了写进稿子才是最坏的结果。存在性检查抓的就是它们，而且**很少触发**
// ——一个只在真有问题时才响的信号才有人看。
//
//   found              —— 语料里有人这么用
//   collocation-unseen —— 词本身有，但这个组合没见过。对"造搭配"这件事最敏感
//                         的恰恰是这一档，所以不能把它并进 found
//   not-found          —— 整体和词头都没查到
export type Tier = 'found' | 'collocation-unseen' | 'not-found'

/** @deprecated 频率门槛已废弃，保留只为旧数据读取时不炸。 */
export const RARE_BELOW = 1e-8

// 词头：短语的第一个词。英语里动词短语的信息量基本都在它身上
// （enmeshed within it → enmeshed）。
export function headWord(form: string): string {
  return form.trim().split(/[\s,]+/)[0] ?? ''
}

// 只看有没有，不看多少。任何非零频率都算"有人这么用过"。
// CRITICAL：查不到绝不默认当成查到了——这一层的全部价值就在于不放过造出来的词。
export function tierOf(freq: number | null, headFreq?: number | null): Tier {
  if (freq != null && freq > 0) return 'found'
  if (headFreq != null && headFreq > 0) return 'collocation-unseen'
  return 'not-found'
}

export type FreqPair = { full: number | null; head: number | null }
export type FetchFreqs = (forms: string[]) => Promise<Record<string, FreqPair | number | null>>

// 一个词的历史语料频率不会变，所以缓存可以永久有效。
// 只缓存查到结果的词——整批取数失败时不写缓存，否则一次网络抖动会把一整批
// 好词永久钉在"未查证"上。
// seed：从持久化里读回来的已知档位，用来预热缓存。一个词的历史语料频率不会变，
// 所以查过的永远不用再查——刷新之后也不该从零开始。
// 旧数据里存的是废弃的档位名（ok / rare / head-only / unverified）。
// 读回来时就地迁移，省得为了几个旧值写一次数据库迁移。
const LEGACY_TIERS: Record<string, Tier> = {
  ok: 'found',
  rare: 'found', // 「罕用」本来就是查到了，只是频率低——那不该是个警告
  'head-only': 'collocation-unseen',
  unverified: 'not-found',
}

function migrateTier(v: string): Tier {
  return (['found', 'collocation-unseen', 'not-found'] as string[]).includes(v)
    ? (v as Tier)
    : (LEGACY_TIERS[v] ?? 'not-found')
}

export function createVerifier(fetchFreqs: FetchFreqs, seed?: Record<string, Tier>) {
  const cache = new Map<string, Tier>(
    seed ? Object.entries(seed).map(([k, v]) => [k, migrateTier(v as string)]) : []
  )

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
    for (const f of unique) out.set(f, cache.get(f) ?? 'not-found')
    return out
  }
}

export { migrateTier }
