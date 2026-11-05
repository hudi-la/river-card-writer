import { useBookStore } from '../state/bookStore'
import { copyVersion, restoreVersion } from './client'
import { compareCards, compareText } from './model'
vi.mock('../lib/supabase', () => ({ cloudEnabled: false, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test', user: { id: 'owner' } } } }) } } }))
const book = { id: 'article', title: 'Current', boxes: [{ id: 'box', name: '素材', cards: [] }], translations: { card: ['current translation'] }, doc: { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'card' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Current body' }] }] }] } }
const old = { id: 'version', name: '一稿', kind: 'named' as const, created_at: '2026-11-05', book: { ...book, title: 'Old', translations: { card: ['old translation'] } } }
beforeEach(() => {
 useBookStore.getState().__resetForTest()
 useBookStore.getState().setLibrary({ books: [structuredClone(book)], activeBookId: book.id, universalBoxes: [{ id: 'universal', name: '通用', cards: [] }] })
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'safety', name: '备份' }, { status: 201 })))
})
afterEach(() => vi.unstubAllGlobals())
it('saves the complete current version before replacing it, preserving identity and universal boxes', async () => {
 const universal = useBookStore.getState().library.universalBoxes
 await restoreVersion(old)
 const sent = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
 expect(sent.kind).toBe('safety'); expect(sent.book).toEqual(book)
 expect(useBookStore.getState().activeBook()?.title).toBe('Old')
 expect(useBookStore.getState().activeBook()?.translations).toEqual(old.book.translations)
 expect(useBookStore.getState().activeBook()?.id).toBe(book.id)
 expect(useBookStore.getState().library.universalBoxes).toBe(universal)
})
it('does not replace anything when safeguarding fails', async () => {
 vi.mocked(fetch).mockResolvedValue(Response.json({ error: '保存失败' }, { status: 503 }))
 await expect(restoreVersion(old)).rejects.toThrow('保存失败')
 expect(useBookStore.getState().activeBook()).toEqual(book)
})
it('aborts if the article or login changes while the safeguard is being saved', async () => {
 vi.mocked(fetch).mockImplementationOnce(async () => {
  useBookStore.getState().renameBook(book.id, 'New change')
  return Response.json({ id: 'safety' })
 })
 await expect(restoreVersion(old)).rejects.toThrow('发生变化')
 expect(useBookStore.getState().activeBook()?.title).toBe('New change')
 await expect(restoreVersion(old, () => false)).rejects.toThrow('已取消恢复')
})
it('copies a version with a fresh identity without changing the original or its active state', () => {
 const id = copyVersion(old)
 expect(id).not.toBe(book.id)
 expect(useBookStore.getState().library.books).toHaveLength(2)
 expect(useBookStore.getState().activeBook()).toEqual(book)
 expect(useBookStore.getState().library.books[1].title).toBe('Old · 一稿')
})
it('compares card text, translation, additions, removals and ordering', () => {
 expect(compareCards(old.book, book).changed).toBe(1)
 const second = { type: 'card', attrs: { cardId: 'second' }, content: [] }
 expect(compareCards(book, { ...book, doc: { ...book.doc, content: [second, book.doc.content[0]] } })).toEqual({ added: 1, removed: 0, changed: 0, moved: 1 })
})

it('shows paragraph additions and deletions without losing unchanged text', () => {
 expect(compareText('第一段\n\n旧段落\n\n结尾', '第一段\n\n新段落\n\n结尾')).toEqual([
  { kind: 'same', text: '第一段' }, { kind: 'removed', text: '旧段落' }, { kind: 'added', text: '新段落' }, { kind: 'same', text: '结尾' },
 ])
 const before = Array.from({ length: 600 }, (_, i) => `段落 ${i}`).join('\n\n')
 const after = before.replace('段落 300', '修改 300')
 const changes = compareText(before, after)
 expect(changes.filter(c => c.kind !== 'added').map(c => c.text).join('\n\n')).toBe(before)
 expect(changes.filter(c => c.kind !== 'removed').map(c => c.text).join('\n\n')).toBe(after)
})
