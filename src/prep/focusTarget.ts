import type { Target } from './types'

// 作者划词备料时，从模型返回里挑出**他划的那一条**。
//
// 为什么要在代码里挑，而不是信提示词：提示词里写了"targets 里只放一条"，但那
// 只是个请求。temperature=1 的模型完全可能把整张卡重新分析一遍返回 8 条——而
// 那 8 条跟作者原有的条目大面积重名，追加时的去重就会把他正在用的那些滤掉，
// 看起来就是"重新备料 + 覆盖"。
//
// 不该靠提示词保证的事，就该在代码里保证。
export function pickFocusedTarget(targets: Target[], phrase: string): Target | null {
  if (targets.length === 0) return null
  const want = phrase.trim()
  if (!want) return targets[0]
  return (
    targets.find((t) => t.zh.trim() === want) ??
    targets.find((t) => want.includes(t.zh.trim()) || t.zh.trim().includes(want)) ??
    targets[0]
  )
}
