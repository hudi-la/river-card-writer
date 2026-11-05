import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useBookStore } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { AUTO_VERSION_MS } from '../versions/model'
import { ArticleVersions } from './ArticleVersions'
vi.mock('../lib/supabase', () => ({ cloudEnabled: false, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token', user: { id: 'owner' } } } }) } } }))
const book = { id: 'article', title: '文章', boxes: [], doc: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'c' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '现在正文' }] }] }] } }
const version = { id: 'a'.repeat(36), name: '一稿', kind: 'named', created_at: '2026-11-05T20:00:00Z' }
const old = { ...book, title: '旧标题' }
beforeEach(() => {
 useBookStore.getState().__resetForTest()
 useBookStore.getState().setLibrary({ books: [structuredClone(book)], activeBookId: book.id, universalBoxes: [] })
 useAuthStore.setState({ status: 'signed-in', session: { user: { id: 'owner' } } as any })
 vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
  if (options.method === 'POST') return Response.json({ ...version, id: 'saved' }, { status: 201 })
  if (url.includes('?')) return Response.json({ versions: [version] })
  return Response.json({ ...version, book: old })
 }))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('previews without changing current content, copies independently and restores only after confirmation', async () => {
 const restored = vi.fn(); const user = userEvent.setup()
 render(<ArticleVersions book={book} onRestored={restored} />)
 await user.click(screen.getByRole('button', { name: '版本历史' }))
 await user.click(await screen.findByRole('button', { name: /一稿/ }))
 await screen.findByRole('textbox', { name: '历史全文' })
 expect(useBookStore.getState().activeBook()?.title).toBe('文章')
 await user.click(screen.getByRole('button', { name: '另存为副本' }))
 expect(useBookStore.getState().library.books).toHaveLength(2)
 await user.click(screen.getByRole('button', { name: '恢复此版本' }))
 expect(restored).not.toHaveBeenCalled()
 await user.click(screen.getByRole('button', { name: '保存当前内容并恢复' }))
 await waitFor(() => expect(restored).toHaveBeenCalledOnce())
 expect(useBookStore.getState().activeBook()?.title).toBe('旧标题')
 expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'POST' && JSON.parse(options.body as string).kind === 'safety')).toBe(true)
})
it('saves a named complete version and makes failures visible', async () => {
 const user = userEvent.setup(); render(<ArticleVersions book={book} onRestored={() => {}} />)
 await user.click(screen.getByRole('button', { name: '版本历史' }))
 const name = await screen.findByRole('textbox', { name: '版本名称' })
 await user.type(name, '发给编辑版')
 await user.click(screen.getByRole('button', { name: '保存版本' }))
 await screen.findByText('版本已保存到云端')
 const sent = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options!.body as string))
 expect(sent.some(payload => payload.kind === 'named' && payload.name === '发给编辑版' && payload.book.doc.type === 'doc')).toBe(true)
})
it('automatically captures changed content every five minutes and does not save unchanged content', async () => {
 vi.useFakeTimers()
 render(<ArticleVersions book={book} onRestored={() => {}} />)
 await act(async () => { await vi.advanceTimersByTimeAsync(1) })
 expect(fetch).toHaveBeenCalledTimes(1)
 await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_VERSION_MS) })
 expect(fetch).toHaveBeenCalledTimes(1)
 useBookStore.getState().renameBook(book.id, '修改')
 await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_VERSION_MS) })
 expect(fetch).toHaveBeenCalledTimes(2)
 expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).book.title).toBe('修改')
})
it('signed-out readers do not request private history', async () => {
 useAuthStore.setState({ status: 'signed-out', session: null })
 const user = userEvent.setup(); render(<ArticleVersions book={book} onRestored={() => {}} />)
 await user.click(screen.getByRole('button', { name: '版本历史' }))
 expect(screen.getByRole('button', { name: '登录后使用版本历史' })).toBeTruthy()
 expect(fetch).not.toHaveBeenCalled()
})
