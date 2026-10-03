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

// ── 存的是段落数组，编辑的是一整块文字 ──────────────────────────────────
//
// 英文一卡一个输入框，不再一段一个盒子。作者的论证（2026-10-02）：当初把英文
// 按段切开，是为了跟中文逐段对应；而对应买到的三样东西现在全没了——段数已经
// 不锁 1:1，行内标记在纯文本里根本进不去，确认也早就是手动按钮。剩下的唯一
// 好处是按序号继承块样式，不值得为它把结构卡死。
//
// 存储仍然是 string[]（一个元素 = 一段）：旧数据不用迁移，splitEn/mergeEn 在
// 中英段数刚好相等时照旧能按序号对齐，备料和 collectEnText 也不用改。变的只是
// 编辑时把它摊成一块文字、写回时再切回来。
//
// 空行分段。段内单个换行是作者自己的断行，原样留着。

export function enToText(en: string[] | null): string {
  return en ? en.join('\n\n') : ''
}

export function textToEn(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== '')
}

// ── DOM ↔ 段落数组 ───────────────────────────────────────────────────────
//
// 英文那一栈是真的段落元素（contenteditable），不是 textarea。换过来的唯一理由
// 是作者要的每段首行缩进：text-indent 作用于块盒的第一行，而一个 textarea 不管
// 里面多少换行都只是**一个**块盒，第二段的首行在 CSS 里根本不存在。
//
// 代价和防线写在 CardView 的 EnField 上面。这里只放两个纯函数——写出去和读回来，
// 往返必须严格相等，那条是这整件事的安全底线，所以它有测试直接跑往返。

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 一个换行就是一段，跟中文栏一致——中文那边也没有"段内软断行"这种东西。
//
// 这条规则同时是一次数据修复。中间有一版是"一卡一个纯文本框、**空行**分段"，
// 而作者段落之间敲的是单个回车，于是写回时整张卡的英文被并成了数组里的一条，
// 中间留着 \n。那样渲染出来只有一个 <p>，只有它的第一行能缩进——作者看到的就是
// 这个（2026-10-03 截图）。在这里把 \n 也当段界拆开，旧数据一读就恢复成多段，
// 不用迁移脚本；下次失焦写回时顺手存成拆好的样子。
export function splitParagraphs(paragraphs: string[]): string[] {
  return paragraphs.flatMap((p) => p.split('\n')).filter((p) => p.trim() !== '')
}

// 段落数组 → HTML。空内容给一个 <p><br></p>，否则那个 <p> 没有高度、光标进不去。
export function paragraphsToHtml(paragraphs: string[]): string {
  const flat = splitParagraphs(paragraphs)
  if (flat.length === 0) return '<p><br></p>'
  return flat.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
}

// 一个节点里的文字，<br> 算一个换行。
function textOf(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue ?? ''
  if (node.nodeType !== 1) return ''
  const el = node as Element
  if (el.tagName === 'BR') return '\n'
  let out = ''
  el.childNodes.forEach((c) => (out += textOf(c)))
  return out
}

// 块级元素：浏览器在 contenteditable 里按回车生成什么，各家不完全一样——Chrome
// 给 <div>，别处可能给 <p>。两个都当段落边界，所以换浏览器不会变形。
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI'])

// DOM → 段落数组。
// 顶层可能混着裸文本节点：有些浏览器把第一行留成裸文本、后面几行才包进块里。
// 那些裸文本归到"当前这一段"，碰到块级元素才结算。
// 最后统一过一遍 splitParagraphs：<br> 在 textOf 里变成 \n，而换行就是段界，
// 所以存进去的段落里永远不含 \n——这让"存 → 读 → 存"是幂等的。
export function readParagraphs(el: HTMLElement): string[] {
  const paras: string[] = []
  let current = ''
  const flush = () => {
    if (current !== '') paras.push(current)
    current = ''
  }
  el.childNodes.forEach((node) => {
    if (node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName)) {
      flush()
      paras.push(textOf(node))
    } else {
      current += textOf(node)
    }
  })
  flush()
  return splitParagraphs(paras)
}
