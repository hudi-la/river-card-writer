import type { Target } from './types'

// 从一段作者确认过的英文里，找出他真正用上了哪些候选词。
//
// 为什么挂在「确认」上：确认是作者唯一一次明确说"这段我认了"。那一刻他写下的
// 英文就是他的选择——比任何"打字时记录"都干净，也不会把他写到一半又删掉的词
// 记成数。这是作者自己提的做法，比原设计（§7 按打字记录）准得多。
//
// 匹配是宽松的：候选可能是 enmeshed，而他写的是 enmeshed 的其他形态或嵌在
// 长句里。只要候选的词形出现在确认文本里（按词边界、忽略大小写）就算用过。
export function usedCandidates(targets: Target[], confirmedText: string): string[] {
  const hay = ` ${confirmedText.toLowerCase().replace(/[^a-z0-9'’-]+/g, ' ')} `
  const out = new Set<string>()
  for (const t of targets) {
    for (const c of t.candidates) {
      const needle = c.en.toLowerCase().replace(/[^a-z0-9'’-]+/g, ' ').trim()
      if (!needle) continue
      if (hay.includes(` ${needle} `)) out.add(c.en.toLowerCase())
    }
  }
  return Array.from(out)
}

// 累计计数。用过的次数越多越说明那是作者的词，不是一次偶然。
export function mergeUsed(
  prev: Record<string, number> | undefined,
  words: string[]
): Record<string, number> {
  const next = { ...(prev ?? {}) }
  for (const w of words) next[w] = (next[w] ?? 0) + 1
  return next
}
