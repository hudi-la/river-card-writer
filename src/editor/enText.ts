// 英文那一半的纯函数底座。刻意不 import 任何 TipTap / React——这一层要能在
// 没有编辑器的环境里单独测，schema 和 CardView 都只是它的调用方。

// "未确认"的哨兵值。enSrc 为空串 = 作者从没对这段英文点过确认。
// 用空串而不是造一个假指纹——不确定就是不确定，别装出一个确定值来源。
export const UNCONFIRMED = ''

/** @deprecated 旧名字，语义已从"过期"改成"未确认"。保留只为少改几处调用。 */
export const STALE_SRC = UNCONFIRMED

// 归一化后的 FNV-1a。归一化只压空白：改一个空格、末尾多一个换行，不该让作者
// 辛苦写的英文被判过期。除此之外任何字变了都算改了。
export function fingerprint(text: string): string {
  const norm = text.replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // 加前缀再转 36 进制：保证结果永远非空，不会意外等于 STALE_SRC。
  return 'f' + (h >>> 0).toString(36)
}

// 一段英文此刻处在哪个状态。
//
// 这里的语义是 2026-10-02 换过的，换法很重要：原来工具断言的是"这段英文过期了"
// ——可工具根本不知道英文还能不能用，它只知道中文的字节变了。那是在断言一件它
// 无从知道的事，而且无路可走（作者没有办法说"还合用"）。
//
// 现在记的是**作者认过没认过**，那是工具确实知道的事。"中文变了就撤销确认"在
// 逻辑上严丝合缝：作者当初认的是"这段英文配那一版中文"，那一版没了，认可自然
// 不再覆盖。
//
//   unwritten   —— 还没写
//   unconfirmed —— 写了，但从没点过确认（中性状态，不该报警）
//   confirmed   —— 作者认过，且中文没再变
//   invalidated —— 作者认过，但之后中文改了，确认已失效
//
// 状态是算出来的，不是存出来的，所以不存在"忘了改状态"的 bug。
export type EnConfirmState = 'unwritten' | 'unconfirmed' | 'confirmed' | 'invalidated'

export function confirmState(en: string[] | null, enSrc: string, zhText: string): EnConfirmState {
  if (en == null) return 'unwritten'
  if (enSrc === UNCONFIRMED) return 'unconfirmed'
  return fingerprint(zhText) === enSrc ? 'confirmed' : 'invalidated'
}

// 守在数据入口的校验器，跟现有的 isValidCover 同一个路子：宽松地判断、永不抛出，
// 形状不对就当"不合格"，绝不让它进文档。
// en.length === 段落数 是全功能依赖的不变量（段落样式靠序号从中文继承、切分靠
// 序号对齐），所以段数不符必须拒绝，不能好心地补齐或截断——补出来的英文跟中文
// 对不上，比没有更有害。
export function isValidEn(raw: unknown, paragraphCount: number): raw is string[] | null {
  if (raw === null) return true
  if (!Array.isArray(raw)) return false
  if (raw.length !== paragraphCount) return false
  return raw.every((s) => typeof s === 'string')
}

// 把一张卡的若干段中文拼成一个字符串再取指纹。分隔符固定下来，保证
// zhFingerprint 和任何手写的 fingerprint(texts.join(...)) 不会悄悄算出两个结果。
export const ZH_JOIN = '\n'

export function zhFingerprint(texts: string[]): string {
  return fingerprint(texts.join(ZH_JOIN))
}

export type EnState = { en: string[] | null; enSrc: string }

// 切分：中文卡在第 index 个段落处被切成两半。
// 只有"在段落边界下刀"且"英文段数等于中文段数"时才敢对齐切——这两个条件由
// 提示词里"保持段落一一对应"那条约束在多数情况下保证成立。
// 对不齐时不猜：英文整份留给前半张，后半张当没写过。留一份对不上的英文比清零
// 好（作者的润色不该消失），但两半都退回未确认。
//
// 确认的传递：原来确认过整份的话，切开后两半各自仍在作者的认可范围内（他认的
// 是这些字配这些中文，切一刀不改变任何一个字），所以能对齐时两半都保留确认。
// 对不齐时一律退回未确认——那时英文和中文的对应关系已经不是作者认过的那个了。
export function splitEn(
  en: string[] | null,
  zhTexts: string[],
  index: number,
  atParagraphBoundary: boolean,
  wasConfirmed = false
): { first: EnState; second: EnState } {
  if (en == null) {
    return { first: { en: null, enSrc: UNCONFIRMED }, second: { en: null, enSrc: UNCONFIRMED } }
  }
  const alignable =
    atParagraphBoundary && en.length === zhTexts.length && index > 0 && index < en.length
  if (!alignable) {
    return { first: { en, enSrc: UNCONFIRMED }, second: { en: null, enSrc: UNCONFIRMED } }
  }
  const stamp = (texts: string[]) => (wasConfirmed ? zhFingerprint(texts) : UNCONFIRMED)
  return {
    first: { en: en.slice(0, index), enSrc: stamp(zhTexts.slice(0, index)) },
    second: { en: en.slice(index), enSrc: stamp(zhTexts.slice(index)) },
  }
}

// 合并：译文的拼接就是拼接的译文。接缝处可能读着略生硬，但那是作者一眼看得见、
// 顺手能改的东西，远好过把他的润色清零。
//
// 确认的传递：合并后只有**两边都确认过**才算确认——作者分别认过 A 和 B，那他
// 认的是 A+B 的全部内容。只要有一边没认过（或压根没写），结果就是未确认。
// CRITICAL：绝不能无条件盖章。原来这里在两边都有英文时直接盖指纹，在新语义下
// 等于系统替作者认了一次，那是最不该发生的事。
export function mergeEn(
  a: string[] | null,
  b: string[] | null,
  mergedZhTexts: string[],
  bothConfirmed = false
): EnState {
  if (a == null && b == null) return { en: null, enSrc: UNCONFIRMED }
  if (a == null || b == null) return { en: (a ?? b) as string[], enSrc: UNCONFIRMED }
  return { en: [...a, ...b], enSrc: bothConfirmed ? zhFingerprint(mergedZhTexts) : UNCONFIRMED }
}
