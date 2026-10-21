import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const state = vi.hoisted(() => ({ status: 'signed-in', requestSignIn: vi.fn() }))
vi.mock('../state/authStore', () => ({ useAuthStore: (select: any) => select(state) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } } }))
import { ArticleShare } from './ArticleShare'
const book = { id: 'book', title: '分享测试', boxes: [{ id: 'box', name: '素材', cards: ['不分享'] }], doc: { type: 'doc', content: [{ type: 'card', attrs: { en: ['English'] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文' }] }] }] } }
beforeEach(() => {
 state.status = 'signed-in'; state.requestSignIn.mockClear()
 vi.stubGlobal('fetch', vi.fn(async (_path: string, options: RequestInit) => Response.json(options.method === 'POST' ? { id: 'a'.repeat(64), title: book.title, created_at: '2026-10-21T23:00:00Z' } : options.method === 'DELETE' ? { ok: true } : { shares: [] })))
})
afterEach(() => vi.unstubAllGlobals())
it('creates only after explicit click, publishes only正文, and copies the public link', async () => {
 const user = userEvent.setup(); render(<ArticleShare book={book} />)
 await user.click(screen.getByRole('button', { name: '分享全文' }))
 await waitFor(() => expect(screen.getByRole('button', { name: '创建分享链接' }).hasAttribute('disabled')).toBe(false))
 expect(fetch).toHaveBeenCalledTimes(1)
 await user.click(screen.getByRole('button', { name: '创建分享链接' }))
 await screen.findByText('链接已创建，可以复制分享。')
 const options = vi.mocked(fetch).mock.calls[1][1]!
 const sent = JSON.parse(options.body as string)
 expect(sent.doc).toEqual(book.doc); expect(sent.boxes).toBeUndefined()
 await user.click(screen.getByRole('button', { name: '复制链接' }))
 await screen.findByText('链接已复制')
 expect(await navigator.clipboard.readText()).toBe(window.location.origin + '/s/' + 'a'.repeat(64))
 await user.click(screen.getByRole('button', { name: '撤销链接' }))
 await screen.findByText('链接已撤销，原文仍保留在 River 中。')
 expect(screen.queryByRole('button', { name: '复制链接' })).toBeNull()
})
it('asks signed-out users to log in without publishing anything', async () => {
 state.status = 'signed-out'
 const user = userEvent.setup(); render(<ArticleShare book={book} />)
 await user.click(screen.getByRole('button', { name: '分享全文' }))
 await user.click(screen.getByRole('button', { name: '登录后创建分享链接' }))
 expect(state.requestSignIn).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled()
})
it('shows service failures and keeps the article preview available', async () => {
 vi.mocked(fetch).mockResolvedValue(Response.json({ error: '暂时不可用' }, { status: 503 }))
 const user = userEvent.setup(); render(<ArticleShare book={book} />)
 await user.click(screen.getByRole('button', { name: '分享全文' }))
 await screen.findByText('暂时不可用')
 await user.click(screen.getByText('查看将要分享的全文'))
 expect((screen.getByRole('textbox', { name: '分享全文预览' }) as HTMLTextAreaElement).value).toContain('中文\n\nEnglish')
})
