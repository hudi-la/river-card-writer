// 英文那一半的纯函数底座。刻意不 import 任何 TipTap / React——这一层要能在
// 没有编辑器的环境里单独测，schema 和 CardView 都只是它的调用方。

// "过期"的哨兵值：enSrc 为空串时，任何中文的指纹都匹配不上它，于是 isStale 恒真。
// 用空串而不是造一个假指纹——不确定就是不确定，别装出一个确定值来源。
export const STALE_SRC = ''

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

// 过期是算出来的，不是存出来的——所以没有任何地方需要"记得打过期标记"，
// 也就不存在忘记打标记的 bug。
// en 为 null 时返回 false：那是"未写"，跟"过期"是两种不同的状态，UI 也要分开显示。
export function isStale(en: string[] | null, enSrc: string, zhText: string): boolean {
  if (en == null) return false
  return fingerprint(zhText) !== enSrc
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
// 对不齐时不猜：英文整份留给前半张并标过期，后半张当没写过。留一份对不上的
// 英文比清零好（作者的润色不该消失），但必须告诉他它已经不可信了。
export function splitEn(
  en: string[] | null,
  zhTexts: string[],
  index: number,
  atParagraphBoundary: boolean
): { first: EnState; second: EnState } {
  if (en == null) {
    return { first: { en: null, enSrc: STALE_SRC }, second: { en: null, enSrc: STALE_SRC } }
  }
  const alignable =
    atParagraphBoundary && en.length === zhTexts.length && index > 0 && index < en.length
  if (!alignable) {
    return { first: { en, enSrc: STALE_SRC }, second: { en: null, enSrc: STALE_SRC } }
  }
  return {
    first: { en: en.slice(0, index), enSrc: zhFingerprint(zhTexts.slice(0, index)) },
    second: { en: en.slice(index), enSrc: zhFingerprint(zhTexts.slice(index)) },
  }
}

// 合并：译文的拼接就是拼接的译文。接缝处可能读着略生硬，但那是作者一眼看得见、
// 顺手能改的东西，远好过把他的润色清零。
// 只有当一边压根没写过时才标过期——那份英文确实盖不全合并后的中文了。
export function mergeEn(a: string[] | null, b: string[] | null, mergedZhTexts: string[]): EnState {
  if (a == null && b == null) return { en: null, enSrc: STALE_SRC }
  if (a == null || b == null) return { en: (a ?? b) as string[], enSrc: STALE_SRC }
  return { en: [...a, ...b], enSrc: zhFingerprint(mergedZhTexts) }
}
