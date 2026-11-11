import { beforeEach, expect, it } from 'vitest'
import { useBookStore, load } from './bookStore'
const key = 'card-writer:library'
beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })
it('new manuscripts have a database-compatible UUID before any sync starts', () => {
  expect(useBookStore.getState().addBook('new manuscript').id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
})
it('an older tab editing another book cannot erase a new manuscript from disk', () => {
  const a = useBookStore.getState().addBook('existing')
  const external = { ...a, id: crypto.randomUUID(), title: 'new in other tab' }
  const disk = JSON.parse(localStorage.getItem(key)!)
  localStorage.setItem(key, JSON.stringify({ ...disk, books: [...disk.books, external] }))
  useBookStore.getState().renameBook(a.id, 'edited in old tab')
  expect(load().books.some(b => b.id === external.id)).toBe(true)
})
it('per-book records recover a new draft even if an old application overwrites the whole library', () => {
  const oldLibrary = JSON.parse(localStorage.getItem(key)!)
  const book = useBookStore.getState().addBook('protected draft')
  localStorage.setItem(key, JSON.stringify(oldLibrary))
  expect(load().books.some(b => b.id === book.id)).toBe(true)
})
it('same-book conflicting edits preserve both versions as separate manuscripts', () => {
  const book = useBookStore.getState().addBook('original')
  const remote = { ...book, title: 'other window edit' }
  localStorage.setItem('card-writer:draft:' + book.id, JSON.stringify({ book: remote }))
  useBookStore.getState().renameBook(book.id, 'this window edit')
  const books = load().books
  expect(books.some(b => b.title === 'this window edit')).toBe(true)
  expect(books.some(b => b.title === 'other window edit · 另一窗口保留')).toBe(true)
})
it('explicit deletion is not undone by per-book recovery and retains a recoverable record', () => {
  const book = useBookStore.getState().addBook('deleted')
  useBookStore.getState().deleteBook(book.id)
  expect(load().books.some(b => b.id === book.id)).toBe(false)
  const draft = JSON.parse(localStorage.getItem('card-writer:draft:' + book.id)!)
  expect(draft.deleted).toBe(true)
  expect(draft.book.title).toBe('deleted')
})
it('reports disk-write failure visibly and retains the manuscript in memory', async () => {
  const { vi } = await import('vitest')
  const { useSaveStatus } = await import('./saveStatus')
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const book = useBookStore.getState().addBook('memory survives quota')
    expect(useBookStore.getState().library.books.some(b => b.id === book.id)).toBe(true)
    expect(useSaveStatus.getState().localError).toContain('导出备份')
  } finally { spy.mockRestore(); warning.mockRestore() }
})
it('a failed local write is retried on the next save instead of becoming the acknowledged baseline', async () => {
  const { vi } = await import('vitest')
  const book = useBookStore.getState().addBook('before quota')
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  useBookStore.getState().renameBook(book.id, 'unsaved edit')
  spy.mockRestore(); warning.mockRestore()
  useBookStore.getState().addBook('next save')
  const record = JSON.parse(localStorage.getItem('card-writer:draft:' + book.id)!)
  expect(record.book.title).toBe('unsaved edit')
})
