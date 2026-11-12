import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { RecoverManuscripts } from './RecoverManuscripts'
import { useAuthStore } from '../state/authStore'
import { useBookStore } from '../state/bookStore'
import { versionApi } from '../versions/client'
vi.mock('../versions/client', () => ({ versionApi: vi.fn() }))
const book = { id: 'lost-id', title: 'Lost manuscript', boxes: [], doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original preserved words' }] }] }] } }
beforeEach(() => {
 localStorage.clear(); useBookStore.getState().__resetForTest()
 useAuthStore.setState({ status: 'signed-in', session: { user: { id: 'owner-a' } } as any })
 vi.mocked(versionApi).mockReset().mockImplementation(async path => path?.startsWith('?') ? { articles: [{ id: 'version-id', book_id: book.id, title: book.title, created_at: '2026-11-10T00:00:00Z' }], nextOffset: null } : { id: 'version-id', name: '自动保存', kind: 'auto', created_at: '2026-11-10T00:00:00Z', book })
})
afterEach(() => { cleanup(); useAuthStore.getState().__resetForTest() })
it('previews and restores to a new book while keeping all current manuscripts', async () => {
 const before = useBookStore.getState().library.books
 render(<RecoverManuscripts />)
 fireEvent.click(screen.getByText('找回稿件')); fireEvent.click(await screen.findByText('Lost manuscript'))
 expect(await screen.findByText('Original preserved words')).toBeTruthy()
 fireEvent.click(screen.getByText('另存恢复稿'))
 const after = useBookStore.getState().library.books
 expect(after).toHaveLength(before.length + 1)
 expect(after.slice(0, before.length)).toEqual(before)
 expect(after[after.length - 1].doc).toEqual(book.doc)
 expect(after[after.length - 1].id).not.toBe(book.id)
})
it('hides a previous account preview and cannot restore it after an account change', async () => {
 render(<RecoverManuscripts />)
 fireEvent.click(screen.getByText('找回稿件')); fireEvent.click(await screen.findByText('Lost manuscript'))
 await screen.findByText('Original preserved words')
 act(() => useAuthStore.setState({ session: { user: { id: 'owner-b' } } as any }))
 await waitFor(() => expect(screen.queryByText('另存恢复稿')).toBeNull())
})
