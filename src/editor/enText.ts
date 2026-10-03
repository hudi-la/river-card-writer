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
//
// CRITICAL：这里**不再**要求 en.length === 中文段数。原来要求了，那是一个会丢
// 数据的设计：作者删掉一段中文之后长度对不上，CardView 把整份 en 当成 null，
// 英文先从屏幕上消失；接着他在这张卡里随便敲一个字，commit 走
// `en ? [...en] : zhTexts.map(() => '')` 这一支，用一串空字符串把真正的英文
// **永久覆盖**掉。
//
// 段数相等只是"能逐段对齐"的前提（splitEn 自己会判断），不该是"这份数据合不
// 合法"的判据。作者的字在任何情况下都不该因为结构对不上而消失。
export function isValidEn(raw: unknown, _paragraphCount?: number): raw is string[] | null {
  if (raw === null) return true
  if (!Array.isArray(raw)) return false
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

// 把第 index 段英文并进第 index-1 段。段数不再锁 1:1（见 isValidEn 的注释和
// spec §14）之后，作者必须能自己改英文的分段——否则他只是看得见多出来的段，
// 却动不了它。这是那次松绑欠下的另一半。
//
// 为什么要把当前这一格的实时文字（currentText）传进来，而不是直接用 en[index]：
// 格子是非受控的 textarea、失焦才写回。作者可能刚敲完就按 Backspace，这时
// en[index] 还是上一次写回的旧值。上一格不存在这个问题——焦点离开它时就已经
// 写回过了。
//
// 接缝处补不补空格：两边都非空、且接缝两侧都不是空白时补一个。英文段落拼接
// 要空格；但作者自己敲在段尾的换行（\n）得原样留着，所以不能一律 trim。
export function mergeEnCells(
  en: string[] | null,
  index: number,
  currentText: string
): { en: string[]; caret: number } | null {
  if (en == null || index < 1) return null
  const prev = en[index - 1] ?? ''
  const cur = currentText
  let joined: string
  if (prev === '') joined = cur
  else if (cur === '') joined = prev
  else joined = prev + (/\s$/.test(prev) || /^\s/.test(cur) ? '' : ' ') + cur
  const next = [...en.slice(0, index - 1), joined, ...en.slice(index + 1)]
  // 光标停在接缝上——作者刚刚按的是 Backspace，他期待光标落在"刚才删掉的那个
  // 边界"的位置，就跟任何编辑器里段首退格的手感一样。
  return { en: next, caret: joined.length - cur.length }
}

// 在光标处把第 index 段英文拆成两段。这是 mergeEnCells 的另一半：中译英有时要
// 加一个中文里没有的过渡段或主题句，那就得能拆。
//
// 手势取 Enter，跟中文栏一致——中文那边 Enter 就是另起一段。段内换行留给
// Shift+Enter（textarea 本来就会插一个 \n，不拦就是了）。
//
// 接缝处剥掉空白：Enter 按在句末的空格后面时，前一段不该留个拖尾空格。这跟
// mergeEnCells 在接缝补空格正好互为逆操作——拆了再合回去，拿到的是原来那一段。
export function splitEnCell(
  en: string[] | null,
  index: number,
  currentText: string,
  caret: number
): { en: string[]; focusIndex: number; caret: number } {
  // en 为 null = 压根没写过英文，别的格子确实都是空的，所以从空串补起是安全的
  // （跟 commit 里那条"绝不从零重建"的禁令不冲突：那条禁的是把已有的英文覆盖掉）。
  const base = en ? [...en] : []
  while (base.length < index) base.push('')
  const before = currentText.slice(0, caret).trimEnd()
  const after = currentText.slice(caret).trimStart()
  const next = [...base.slice(0, index), before, after, ...base.slice(index + 1)]
  // 光标跟到新的那一段的开头——作者按 Enter 就是要开始写下一段。
  return { en: next, focusIndex: index + 1, caret: 0 }
}

// 把整篇的英文收成一段连续的纯文本。
//
// 为什么需要这个：每段英文是一个独立的 textarea，而 textarea 的选区只存在于它
// 自己内部——原生选择跨不过两个 textarea，所以作者拖鼠标选不到"上下两块一起"。
// 那个结构是故意的（contentEditable 会把 HTML 和字号带进正文、所见非所存，见
// CardView 顶上的注释），不该为了能拖选就拆掉。缺的是一个出口，不是选区。
//
// 段落之间空一行：粘到别处时段落边界看得出来。段内作者自己敲的换行（Shift+Enter
// 插的 \n）原样留着——那是他写的东西。空段落不输出。
export function collectEnText(doc: unknown): string {
  const cards = (doc as { content?: unknown[] } | null)?.content ?? []
  const paras: string[] = []
  for (const card of cards) {
    const en = (card as { attrs?: { en?: unknown } } | null)?.attrs?.en
    if (!Array.isArray(en)) continue
    for (const p of en) {
      if (typeof p === 'string' && p.trim() !== '') paras.push(p)
    }
  }
  return paras.join('\n\n')
}
