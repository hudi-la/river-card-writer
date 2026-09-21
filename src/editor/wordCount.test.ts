import { describe, it, expect } from 'vitest'
import { countWords, countCardWords } from './wordCount'

describe('countWords', () => {
  it('汉字逐字算 1', () => {
    expect(countWords('他说了三个字')).toBe(6)
  })

  it('中文里的标点算字（跟 Word 的中文字数口径一致）', () => {
    expect(countWords('他说：“好。”')).toBe(7) // 他说好 3 + ：“。” 4
    expect(countWords('等等——还有……')).toBe(8) // 等等还有 4 + —— 2 + …… 2
    expect(countWords('《书名》、（注）')).toBe(8)
  })

  it('连续的拉丁字母/数字串算 1 个词', () => {
    expect(countWords('hello world')).toBe(2)
    expect(countWords('GPT-4 is here')).toBe(3) // 词内连字符不断词
    expect(countWords("don't stop")).toBe(2) // 词内撇号不断词
    expect(countWords('don’t stop')).toBe(2) // 弯撇号同理
  })

  it('中英混排：中文逐字 + 英文逐词', () => {
    expect(countWords('他说：“hello world。”')).toBe(8) // 他说 2 + ：“。” 4 + 2 词
    expect(countWords('他说“hello”')).toBe(5) // 他说 2 + “” 2 + 1 词
  })

  it('纯英文段落：弯引号、破折号、省略号都不算字，只数词', () => {
    expect(countWords('“Hello,” she said — softly…')).toBe(4)
  })

  it('半角标点不算字', () => {
    expect(countWords("Hello, world! Isn't it?")).toBe(4)
    expect(countWords('他说:"好"')).toBe(3)
  })

  it('空白、换行、制表符、全角空格都不算字', () => {
    expect(countWords('  一 二\n三\t四　五 ')).toBe(5)
    expect(countWords('hello\nworld')).toBe(2)
  })

  it('空串 / 纯空白 / 非字符串都是 0', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
    expect(countWords(null as any)).toBe(0)
    expect(countWords(undefined as any)).toBe(0)
  })

  it('数字串整串算 1 个词', () => {
    expect(countWords('2026 年 7 月')).toBe(4) // 2026 + 年 + 7 + 月
    expect(countWords('2026年')).toBe(2)
  })

  it('全角字母/数字按全角字符逐个算', () => {
    expect(countWords('ＡＢ１')).toBe(3)
  })

  it('日文假名、韩文也逐字算', () => {
    expect(countWords('ひらがなカタカナ')).toBe(8)
    expect(countWords('한국어')).toBe(3)
  })

  it('带重音的西文字母算在词里', () => {
    expect(countWords('café naïve')).toBe(2)
  })

  it('emoji 之类的其它符号不算字', () => {
    expect(countWords('好👍')).toBe(1)
  })
})

describe('countCardWords', () => {
  const card = (texts: string[]) => ({
    type: 'card',
    attrs: { cardId: 'c0' },
    content: texts.map((t) => ({ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] })),
  })

  it('把卡里所有段落的字数加起来', () => {
    expect(countCardWords(card(['第一段', '第二段话']))).toBe(7)
  })

  it('段落之间不会把首尾的词粘在一起', () => {
    expect(countCardWords(card(['hello', 'world']))).toBe(2)
  })

  it('中/英按段落各自判断：英文段落里的弯引号不算字', () => {
    expect(countCardWords(card(['他说“好”', '“Fine,” she said']))).toBe(5 + 3)
  })

  it('一段里有多个 text 节点（带标记的文字）照样连起来数', () => {
    const c = {
      type: 'card',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hel' }, { type: 'text', text: 'lo 世界' }] }],
    }
    expect(countCardWords(c)).toBe(3)
  })

  it('空卡 / 畸形数据是 0，不抛错', () => {
    expect(countCardWords(card(['']))).toBe(0)
    expect(countCardWords(null)).toBe(0)
    expect(countCardWords({})).toBe(0)
    expect(countCardWords({ type: 'card', content: 'not-an-array' })).toBe(0)
  })
})
