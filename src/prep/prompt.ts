// 提示词正文放在同目录的 prompt.md，由构建时内联进来。
// 之所以分开：它是要反复迭代的产品内容，不是代码；而且提示词的每一次改动都
// 应该能在 git 里单独看见 diff。
import PREP_SYSTEM from './prompt.md?raw'
import PREP_AUTO from './prompt-auto.md?raw'
import PREP_ONE from './prompt-one.md?raw'
import PREP_SETTLED from './prompt-settled.md?raw'
import type { AiPolicy } from './types'

export { PREP_SYSTEM, PREP_AUTO, PREP_ONE, PREP_SETTLED }

// 提示词按缓存前缀排：稳定的（骨架指令）在前，易变的（这一次的中文）在后。
// 连着备料同一本书时前缀命中缓存，那部分几乎不要钱。
//
// auto 档在骨架之后追加一段，而不是换一份提示词：两档共用的那 7KB 因此仍然是
// 同一个前缀，缓存照样命中；而"多要一个 translation 字段"这件事在 git 里是
// 一个独立的小文件，改它不会搅动主提示词的 diff。
// focus：作者自己划出来的那个词。给了就只为它做一条条目——他卡在哪儿只有他
// 知道，模型捞的是它认为重要的，两者不该互相取代。
// settled：作者在别处已经确认用过的译法（中文词 → 英文）。
// 这是备料唯一的跨卡上下文。没有它的话，同一个「关系策略」这张卡给
// relational strategy、下一张可能给别的说法——一篇论文里同一个概念换着词说，
// 比用一个不够完美的词更糟。
export function buildPrepRequest(
  zhTexts: string[],
  policy: AiPolicy = 'strict',
  focus?: string,
  settled?: Record<string, string>
): { system: string; user: string } {
  let system = policy === 'auto' ? PREP_SYSTEM + PREP_AUTO : PREP_SYSTEM
  // 排在 focus 之前：它是稳定的（整篇共用），放前面缓存前缀才留得住。
  const pairs = Object.entries(settled ?? {}).filter(([zh, en]) => zh && en)
  if (pairs.length > 0) {
    system += PREP_SETTLED.replace(
      '{{SETTLED}}',
      pairs.map(([zh, en]) => `- 「${zh}」→ ${en}`).join('\n')
    )
  }
  if (focus && focus.trim()) system += PREP_ONE.replace('{{PHRASE}}', focus.trim())
  return {
    system,
    user: `下面是要备料的中文：\n\n${zhTexts.join('\n\n')}`,
  }
}
