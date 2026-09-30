import type { PrepResult } from './types'
import type { Tier } from './verify'

export type CardInput = { cardId: string; zhTexts: string[] }

// 同时跑几张卡。实测一次模型调用 24 秒（顺利）到 60 秒（撞 503 要重试换模型），
// 所以串行跑一章 10 张卡是 4–10 分钟干等——不可接受。
// 上限取 3 而不是更高：Gemini 免费额度是每分钟 20 次请求，而每张卡在重试链下
// 可能用掉 1–3 次。3 路并发把一章压到两分钟量级，又不至于自己把自己限流。
export const PREP_CONCURRENCY = 3

export type RunPrepDeps = {
  requestPrep: (zhTexts: string[]) => Promise<{ ok: true; value: PrepResult } | { ok: false; error: string }>
  verify: (forms: string[]) => Promise<Map<string, Tier>>
  // 每张卡一完成就交出去，不等整批——边栏因此边跑边长出内容，作者不用干等。
  onCardDone: (cardId: string, result: PrepResult) => void
  onTiers: (tiers: Map<string, Tier>) => void
  onProgress: (done: number, total: number) => void
  onError: (cardId: string, error: string) => void
  // 作者按「停」时返回 true。检查点在每一批之间——已经发出的请求不中断
  // （中断也省不下钱，那次调用已经花掉了），但不再发新的。
  shouldStop?: () => boolean
}

// 空白卡（只有空段落）不值得花一次调用。
export function hasContent(card: CardInput): boolean {
  return card.zhTexts.join('').trim() !== ''
}

// 已经备过的卡默认跳过，所以「备整章」是增量的：中断后再按一次只补没做的，
// 不会把已有的重新花钱算一遍。
// 想强制重算某张卡，走「备这张卡」——那是显式动作，总是重跑。
export function cardsToPrep(
  cards: CardInput[],
  existingHints: Record<string, PrepResult> | undefined
): CardInput[] {
  return cards.filter((c) => hasContent(c) && !existingHints?.[c.cardId])
}

// 按批并发跑。每批结束后把这一批所有候选的裸词形一次性送去查证——查证一批
// 只要 1.3 秒，按卡分开查纯属浪费往返。
export async function runPrep(
  cards: CardInput[],
  deps: RunPrepDeps
): Promise<{ done: number; failed: number; stopped: boolean }> {
  let done = 0
  let failed = 0
  const total = cards.length
  deps.onProgress(0, total)

  for (let i = 0; i < cards.length; i += PREP_CONCURRENCY) {
    if (deps.shouldStop?.()) return { done, failed, stopped: true }

    const batch = cards.slice(i, i + PREP_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (card) => {
        const r = await deps.requestPrep(card.zhTexts)
        if (!r.ok) {
          deps.onError(card.cardId, r.error)
          return null
        }
        // 立刻交出去：边栏边跑边长内容。
        deps.onCardDone(card.cardId, r.value)
        return r.value
      })
    )

    for (const r of results) r ? done++ : failed++
    deps.onProgress(done + failed, total)

    // 这一批所有候选的裸词形，一次查完。
    // CRITICAL：包 try/catch。提词在这之前就已经交出去了，查证只是给它加徽章；
    // 查证挂掉绝不能让整章的循环死在这里、后面的卡再也不跑。查不到的词会在
    // UI 上保守地显示为"未查证"，那已经是正确的降级。
    const forms = results
      .filter((r): r is PrepResult => r !== null)
      .flatMap((r) => r.targets.flatMap((t) => t.candidates.map((c) => c.verifyForm)))
    if (forms.length > 0) {
      try {
        deps.onTiers(await deps.verify(forms))
      } catch {
        // 无徽章 > 整章中断。
      }
    }
  }

  return { done, failed, stopped: false }
}
