// 备料条目的类型定义，唯一定义处。
//
// CRITICAL：这里没有、也永远不要加"例句"之类的句子字段。早期草案有一个，
// v1 砍掉了——它是整个条目里最接近"替作者写句子"的地方，而语感 + 缺点两个
// 字段已经把它的作用扛下来了。没有字段可以装句子，模型就没有地方放句子；
// 这比写一条"不许给例句"的规则可靠得多。
export type Candidate = {
  en: string
  // 拿去查语料的裸词形：只有候选自己的词，不加宾语/主语/上下文，≤5 词。
  // 写成「动词+宾语」会让四成好词被误标成未查证（spec §11.1 的误报陷阱）。
  verifyForm: string
  register: string
  nuance: string
  whyFits: string
  // 它丢了什么。必填、不许空——没有任何候选可以只有优点。
  loses: string
}

export type Target = {
  zh: string
  zhQuote: string
  category: string
  // 1 = 最该先看。承重句和"中文本身有歧义"通常是 1–2。
  priority: number
  whyZhIsPrecise: string
  flatTranslation: { text: string; whyItDies: string }
  candidates: Candidate[]
  noSingleWord: boolean
  family: string
  // 这条是作者自己划词要来的，不是模型捞出来的。两者性质不同——模型捞的是
  // 它认为重要的，作者划的是他卡住的地方——所以在边栏里要分得开。
  byAuthor?: boolean
}

export type Genre = 'narrative' | 'expository' | 'other'

// 这份稿子允许 AI 做到哪一档。
//   strict —— 边栏只看词卡（备料、加词）。条目 schema 里没有任何能装句子的
//             字段，模型没地方放句子；校验器见到 translation 一律拒收。
//   auto   —— 边栏只看整句译文：按「翻译」把当前这张卡逐段直译。这是 §9.3
//             主动开的口子，不是意外漏的。译文也绝不进 en——en 只装作者敲的字。
// （早期设计里还有个 open「加骨架」档，作者明确要求砍掉，不留半成品。）
export type AiPolicy = 'strict' | 'auto'

// 读进来的档位，认不出的一律退成最严的那档——不确定时必须保守，
// 因为搞错的代价是作者拿着含 AI 句法的稿子去交给禁 AI 的接收方。
export function toAiPolicy(raw: unknown): AiPolicy {
  return raw === 'auto' ? 'auto' : 'strict'
}

export type PrepResult = {
  genre: Genre
  genreReason: string
  targets: Target[]
}
