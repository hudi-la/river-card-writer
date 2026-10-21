// Shared by browser exports and MCP. No UI, database or runtime dependencies.
export type Language = 'both' | 'zh' | 'en'
export type ArticleBook = { id: string; title: string; doc: any; updatedAt?: string; subtitle?: string; author?: string }
export type ArticleBlock = { cardId: string; language: 'zh' | 'en'; text: string; style: string }
export function textOf(node: any): string {
  if (node?.type === 'hardBreak') return '\n'
  if (typeof node?.text === 'string') return node.text
  return Array.isArray(node?.content) ? node.content.map(textOf).join('') : ''
}
export function articleBlocks(book: ArticleBook, language: Language = 'both') {
  const blocks: ArticleBlock[] = []
  const warnings: string[] = []
  for (const [index, card] of (book.doc?.content ?? []).entries()) {
    const cardId = card.attrs?.cardId || `card-${index + 1}`
    const zh = (card.content ?? []).map((p: any) => ({ text: textOf(p), style: p.attrs?.style || 'body' }))
    // Keep empty array slots: they can represent a missing translation for one paragraph.
    const en: string[] = Array.isArray(card.attrs?.en)
      ? card.attrs.en.flatMap((p: unknown) => typeof p === 'string' ? p.split('\n') : ['']) : []
    const add = (lang: 'zh' | 'en', text: string, style = 'body') => {
      if (text.trim()) blocks.push({ cardId, language: lang, text, style })
    }
    if (language === 'zh') { zh.forEach((p: any) => add('zh', p.text, p.style)); continue }
    if (language === 'en') { en.forEach(p => add('en', p)); continue }
    if (en.some(p => p.trim()) && en.length !== zh.length) {
      const warning = `第 ${index + 1} 张卡片中英文段数不同（${zh.length}/${en.length}），未逐段配对；以下保留该卡片的中文与英文全文。`
      warnings.push(warning)
      // Never invent correspondence or silently discard unmatched text.
      add('zh', `【${warning}】`, 'note')
      zh.forEach((p: any) => add('zh', p.text, p.style))
      en.forEach(p => add('en', p))
    } else {
      zh.forEach((p: any, i: number) => { add('zh', p.text, p.style); if (en[i]) add('en', en[i], p.style) })
    }
  }
  return { blocks, warnings }
}
function escapeMarkdown(s: string) { return s.replace(/([\\`*_{}\[\]<>#!|~])/g, '\\$1').replace(/^(\s*\d+)\./gm, '$1\\.') }
export function renderArticle(book: ArticleBook, language: Language = 'both', format: 'txt' | 'md' = 'txt') {
  const { blocks, warnings } = articleBlocks(book, language)
  const header = [book.title, book.subtitle, book.author].filter(Boolean) as string[]
  const body = blocks.map(p => {
    if (format === 'txt') return p.text
    const prefix: Record<string, string> = { chapter: '## ', h1: '### ', h2: '#### ', bullet: '- ', quote: '> ', note: '> ' }
    return (prefix[p.style] || '') + escapeMarkdown(p.text).replace(/\n/g, p.style === 'quote' ? '\n> ' : '\n')
  })
  const heading = format === 'md' ? header.map((s, i) => (i === 0 ? '# ' : '') + escapeMarkdown(s)) : header
  return { text: [...heading, ...body].join('\n\n') + '\n', warnings }
}
