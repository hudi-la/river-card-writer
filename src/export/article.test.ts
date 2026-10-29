import { renderArticle, articleBlocks } from '../../supabase/functions/_shared/article'
import { callRiverTool, type Repository } from '../../supabase/functions/_shared/mcp'
import { webcrypto } from 'node:crypto'
const p = (text: string, style = 'body') => ({ type: 'paragraph', attrs: { style }, content: [{ type: 'text', text }] })
const card = (zh: any[], en: string[] | null = null) => ({ type: 'card', attrs: { en }, content: zh })
const book = (content: any[]) => ({ id: 'one', title: '文章', doc: { type: 'doc', content } })
beforeAll(() => { vi.stubGlobal('crypto', webcrypto) })
afterAll(() => { vi.unstubAllGlobals() })
it('interleaves paragraphs, retains empty translation slots and folded text', () => {
 const b = book([card([p('甲'), p('乙'), p('丙')], ['A', '', 'C']), card([p('折叠正文')])])
 expect(renderArticle(b).text).toBe('文章\n\n甲\n\nA\n\n乙\n\n丙\n\nC\n\n折叠正文\n')
})
it('normalizes legacy newline-separated English', () => {
 expect(renderArticle(book([card([p('甲'), p('乙')], ['A\nB'])])).text).toBe('文章\n\n甲\n\nA\n\n乙\n\nB\n')
})
it('does not invent alignment or lose mismatched English', () => {
 const b = book([card([p('甲'), p('乙')], ['A', 'B', 'C'])])
 const out = renderArticle(b)
 expect(out.warnings).toHaveLength(1)
 expect(out.text).toContain('甲\n\n乙\n\nA\n\nB\n\nC')
 expect(renderArticle(b, 'en').text).toBe('文章\n\nA\n\nB\n\nC\n')
})
it('preserves heading structure without exporting materials', () => {
 const b = { ...book([card([p('标题', 'chapter'), p('<script>正文')], ['Title', 'Body'])]), boxes: [{ cards: [p('秘密素材')] }] }
 expect(renderArticle(b, 'both', 'md').text).toContain('## 标题\n\n## Title')
 expect(renderArticle(b).text).not.toContain('秘密素材')
 expect(articleBlocks(b).blocks).toHaveLength(4)
})
it('MCP paginates without loss and refuses mixed versions', async () => {
 const b = book([card([p('甲'.repeat(32000))], ['English'])])
 const repo: Repository = { list: async () => [], get: async () => b }
 const first: any = await callRiverTool(repo, 'read_article', { bookId: 'one' })
 expect(first.complete).toBe(false)
 let text = first.text, page = first
 while (page.nextOffset !== null) { page = await callRiverTool(repo, 'read_article', { bookId: 'one', offset: page.nextOffset, version: first.version }); text += page.text }
 expect(text).toBe(renderArticle(b).text)
 b.title = '改变'
 await expect(callRiverTool(repo, 'read_article', { bookId: 'one', offset: first.nextOffset, version: first.version })).rejects.toThrow('版本')
})
it('reads a chapter including nested sections, even within a card', async () => {
 const b = book([card([p('一', 'chapter'), p('正文'), p('节', 'h1'), p('细节'), p('二', 'chapter'), p('下一章')], ['One', 'Body', 'Section', 'Details', 'Two', 'Next'])])
 const repo: Repository = { list: async () => [], get: async () => b }
 const result: any = await callRiverTool(repo, 'read_chapter', { bookId: 'one', chapterId: 'section-0' })
 expect(result.text).toContain('细节\n\nDetails')
 expect(result.text).not.toContain('下一章')
})
it('missing or unauthorized IDs return no content', async () => {
 const repo: Repository = { list: async () => [], get: async () => null }
 await expect(callRiverTool(repo, 'read_article', { bookId: 'other' })).rejects.toThrow('无权')
})
