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
}

export type Genre = 'narrative' | 'expository' | 'other'

export type PrepResult = {
  genre: Genre
  genreReason: string
  targets: Target[]
}
