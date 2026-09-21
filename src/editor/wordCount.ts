// 字数统计——中文按中文惯例逐字数（汉字 + 中文标点，跟 Word 的"中文字数"一致），
// 英文按词数（连续的字母/数字算 1 个词）。空白和半角标点不算字。
//
// 弯引号 “”‘’、破折号 —、省略号 …、间隔号 · 这几个符号中英文共用：写在中文里
// 它们是中文标点、要算字；写在英文里它们只是词边的符号、不算。判断粒度是"一段
// 文字"——这段里出现过汉字/假名/谚文就当中文段落处理，否则当英文段落。
// countCardWords 按段落分别调用 countWords，所以一张卡里中英段落各算各的。

// 西文词：拉丁（含带重音的扩展拉丁）/ 希腊 / 西里尔字母 + 半角数字。词内的撇号、
// 连字符不断词（don't、GPT-4 各算 1 个）。全角字母数字不在这里，走下面的逐字算。
const WORD_CHAR = "A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF"
const WORD_RE = new RegExp(`[${WORD_CHAR}]+(?:['’\\-][${WORD_CHAR}]+)*`, 'g')

// 逐字算 1 的字符：汉字、假名、谚文，以及 CJK 标点（、-〿，跳过
// 全角空格）、全角/半角形式（！-･）、竖排和兼容标点。
const CJK_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}、-〿！-･︐-︙︰-﹏]/u

// 判断"这段是不是中文"只看文字本身，不看标点——一段全是全角标点的文字不算中文段落
// 也无所谓，全角标点本来就在 CJK_CHAR_RE 里，照样逐个算。
const CJK_SCRIPT_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

const SHARED_PUNCT = new Set(['“', '”', '‘', '’', '—', '…', '·'])

export function countWords(text: string): number {
  if (typeof text !== 'string' || !text) return 0
  let count = 0
  // 先把西文词整个数掉并替换成空格——剩下的字符里就不会再有词内的弯撇号
  // （don’t 的 ’）被当成中文标点多算一次。
  const rest = text.replace(WORD_RE, () => {
    count++
    return ' '
  })
  const isChinese = CJK_SCRIPT_RE.test(text)
  for (const ch of rest) {
    if (CJK_CHAR_RE.test(ch)) count++
    else if (isChinese && SHARED_PUNCT.has(ch)) count++
  }
  return count
}

// 一张卡（JSON 形状：card.content 是 paragraph 数组，paragraph.content 是 text 节点
// 数组）的字数。按段落分别数再加总：段落边界天然断词（上一段末尾的词不会跟下一段
// 开头粘成一个），中/英判断也按段落各自做。
export function countCardWords(cardJSON: any): number {
  const paragraphs = Array.isArray(cardJSON?.content) ? cardJSON.content : []
  let total = 0
  for (const p of paragraphs) {
    const texts = Array.isArray(p?.content) ? p.content : []
    total += countWords(texts.map((t: any) => t?.text ?? '').join(''))
  }
  return total
}
