// 提示词正文放在同目录的 prompt.md，由构建时内联进来。
// 之所以分开：它是要反复迭代的产品内容，不是代码；而且提示词的每一次改动都
// 应该能在 git 里单独看见 diff。
import PREP_SYSTEM from './prompt.md?raw'
import PREP_SETTLED from './prompt-settled.md?raw'
import PREP_WORD from './prompt-word.md?raw'
import PREP_TRANSLATE from './prompt-translate.md?raw'

export { PREP_SYSTEM, PREP_SETTLED, PREP_WORD, PREP_TRANSLATE }

// 提示词按缓存前缀排：稳定的（骨架指令）在前，易变的（这一次的中文）在后。
// 连着备料同一本书时前缀命中缓存，那部分几乎不要钱。
//
// settled：作者在别处已经确认用过的译法（中文词 → 英文）。
// 这是备料唯一的跨卡上下文。没有它的话，同一个「关系策略」这张卡给
// relational strategy、下一张可能给别的说法——一篇论文里同一个概念换着词说，
// 比用一个不够完美的词更糟。
export function buildPrepRequest(
  zhTexts: string[],
  settled?: Record<string, string>
): { system: string; user: string } {
  let system = PREP_SYSTEM
  // 整篇共用的稳定内容，放前面缓存前缀才留得住。
  const pairs = Object.entries(settled ?? {}).filter(([zh, en]) => zh && en)
  if (pairs.length > 0) {
    system += PREP_SETTLED.replace(
      '{{SETTLED}}',
      pairs.map(([zh, en]) => `- 「${zh}」→ ${en}`).join('\n')
    )
  }
  return {
    system,
    user: `下面是要备料的中文：\n\n${zhTexts.join('\n\n')}`,
  }
}


// 加词：跟备料是**两个功能**，所以是两份提示词。
//
// 备料是"通读这段，找出质感最重的地方"——模型要判断文体、挑靶心、排优先级，
// 那 7.3KB 的指令都是为这件事写的。
// 加词只回答一个问题："这个词用哪个英文好？" 作者已经指了，不需要任何挑选判断。
// 原来的做法是把完整备料提示词发过去再追加一句"只输出一条"，然后在代码里把多
// 出来的滤掉——那是让模型做一件它不该做的事，再去收拾它的结果。
export function buildWordRequest(
  zhTexts: string[],
  phrase: string,
  settled?: Record<string, string>
): { system: string; user: string } {
  let system = PREP_WORD
  const pairs = Object.entries(settled ?? {}).filter(([zh, en]) => zh && en)
  if (pairs.length > 0) {
    system += PREP_SETTLED.replace(
      '{{SETTLED}}',
      pairs.map(([zh, en]) => `- 「${zh}」→ ${en}`).join('\n')
    )
  }
  return {
    system,
    user: `这一段中文：\n\n${zhTexts.join('\n\n')}\n\n其中这个词：「${phrase}」`,
  }
}


// 翻译：「给译文」档的按钮。跟备料、加词都是不同的功能——不挑词、不判断文体，
// 只是逐段直译，所以提示词只有几行。整套备料提示词塞给它只会更慢更贵。
export function buildTranslateRequest(zhTexts: string[]): { system: string; user: string } {
  return { system: PREP_TRANSLATE, user: JSON.stringify(zhTexts) }
}
