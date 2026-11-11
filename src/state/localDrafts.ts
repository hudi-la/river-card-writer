import type { Book, Library } from './bookStore'
import { useSaveStatus } from './saveStatus'

// Per-book records survive an older tab overwriting the legacy whole-library key.
// Only books changed by THIS tab are written; unchanged stale books never replace
// another tab's record. Removed books retain their complete content for recovery.
export const DRAFT_PREFIX = 'card-writer:draft:'
type Draft = { book: Book; deleted?: boolean }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function records(): Map<string, Draft> {
  const result = new Map<string, Draft>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(DRAFT_PREFIX)) continue
    try {
      const value = JSON.parse(localStorage.getItem(key)!)
      if (value?.book?.id && value.book.doc && Array.isArray(value.book.boxes)) result.set(value.book.id, value)
    } catch { /* A damaged record must not hide other intact manuscripts. */ }
  }
  return result
}
export function recoverDrafts(library: Library): Library {
  try {
    const drafts = records()
    const books: Book[] = []
    for (const book of library.books) {
      const draft = drafts.get(book.id)
      drafts.delete(book.id)
      if (draft?.deleted) continue
      const newer = draft && (!book.updatedAt || !draft.book.updatedAt || Date.parse(draft.book.updatedAt) >= Date.parse(book.updatedAt))
      books.push(newer ? draft.book : book)
    }
    for (const draft of drafts.values()) if (!draft.deleted) books.push(draft.book)
    return { ...library, books }
  } catch { return library }
}
export function persistDrafts(library: Library, previous: Library | null) {
  const before = new Map(previous?.books.map(b => [b.id, b]) ?? [])
  const currentIds = new Set(library.books.map(b => b.id))
  const drafts = records()
  const write = (value: Draft) => localStorage.setItem(DRAFT_PREFIX + value.book.id, JSON.stringify(value))
  for (const book of library.books) {
    const base = before.get(book.id)
    if (same(base, book) && drafts.has(book.id)) continue
    const disk = drafts.get(book.id)
    // Concurrent edits to the SAME manuscript: retain the other version as an
    // independent visible copy rather than silently replacing it.
    if (base && disk && !disk.deleted && !same(base, disk.book) && !same(book, disk.book)) {
      const copy = { ...disk.book, id: crypto.randomUUID(), title: `${disk.book.title} · 另一窗口保留` }
      write({ book: copy })
      library.books = [...library.books, copy]
    }
    write({ book })
  }
  for (const book of before.values()) if (!currentIds.has(book.id)) write({ book, deleted: true })
  // Preserve unknown books from legacy tabs too, before writing the whole library.
  const raw = localStorage.getItem('card-writer:library')
  const stored = raw ? JSON.parse(raw) : null
  const missing = new Map<string, Book>()
  for (const book of stored?.books ?? []) if (!before.has(book.id) && !currentIds.has(book.id)) missing.set(book.id, book)
  for (const draft of records().values()) {
    if (!draft.deleted && !before.has(draft.book.id) && !currentIds.has(draft.book.id)) missing.set(draft.book.id, draft.book)
    if (draft.deleted) missing.delete(draft.book.id)
  }
  const already = new Set(library.books.map(b => b.id))
  library.books = [...library.books, ...[...missing.values()].filter(b => !already.has(b.id))]
}
export function reportLocalSave(error?: unknown) {
  useSaveStatus.setState({ localError: error ? '浏览器未能保存稿件。请立即导出备份，并保持本页打开。' : '' })
}
