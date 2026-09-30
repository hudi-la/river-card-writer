// 提示词正文放在同目录的 prompt.md，由构建时内联进来。
// 之所以分开：它是要反复迭代的产品内容，不是代码；而且提示词的每一次改动都
// 应该能在 git 里单独看见 diff。
import PREP_SYSTEM from './prompt.md?raw'
import PREP_AUTO from './prompt-auto.md?raw'
import type { AiPolicy } from './types'

export { PREP_SYSTEM, PREP_AUTO }

// 提示词按缓存前缀排：稳定的（骨架指令）在前，易变的（这一次的中文）在后。
// 连着备料同一本书时前缀命中缓存，那部分几乎不要钱。
//
// auto 档在骨架之后追加一段，而不是换一份提示词：两档共用的那 7KB 因此仍然是
// 同一个前缀，缓存照样命中；而"多要一个 translation 字段"这件事在 git 里是
// 一个独立的小文件，改它不会搅动主提示词的 diff。
export function buildPrepRequest(zhTexts: string[], policy: AiPolicy = 'strict'): { system: string; user: string } {
  return {
    system: policy === 'auto' ? PREP_SYSTEM + PREP_AUTO : PREP_SYSTEM,
    user: `下面是要备料的中文：\n\n${zhTexts.join('\n\n')}`,
  }
}
