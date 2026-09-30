// 提示词正文放在同目录的 prompt.md，由构建时内联进来。
// 之所以分开：它是要反复迭代的产品内容，不是代码；而且提示词的每一次改动都
// 应该能在 git 里单独看见 diff。
import PREP_SYSTEM from './prompt.md?raw'

export { PREP_SYSTEM }

// 提示词按缓存前缀排：稳定的（骨架指令）在前，易变的（这一次的中文）在后。
// 连着备料同一本书时前缀命中缓存，那部分几乎不要钱。
export function buildPrepRequest(zhTexts: string[]): { system: string; user: string } {
  return {
    system: PREP_SYSTEM,
    user: `下面是要备料的中文：\n\n${zhTexts.join('\n\n')}`,
  }
}
