import type { Book } from '../state/bookStore'

export type VersionKind = 'named' | 'auto' | 'safety'
export type ArticleVersion = { id: string; name: string; kind: VersionKind; created_at: string }
export type VersionDetail = ArticleVersion & { book: Book }
export const AUTO_VERSION_MS = 5 * 60 * 1000

export function versionContent(book: Book): string {
  const { updatedAt: _time, ...content } = book
  return JSON.stringify(content)
}

export function validVersionBook(book: any): book is Book {
  const validCard = (card: any) => card?.type === 'card' && Array.isArray(card.content) && card.content.length > 0 && card.content.every((p: any) =>
    p?.type === 'paragraph' && (p.content === undefined || (Array.isArray(p.content) && p.content.every((n: any) =>
      n?.type === 'hardBreak' || (n?.type === 'text' && typeof n.text === 'string' && n.text.length > 0)))))
  return !!book && typeof book.id === 'string' && book.id.length > 0 && book.id.length <= 200 &&
    typeof book.title === 'string' && book.title.length <= 1000 &&
    book.doc?.type === 'doc' && Array.isArray(book.doc.content) && book.doc.content.length > 0 && book.doc.content.every(validCard) &&
    Array.isArray(book.boxes) && book.boxes.every((box: any) => typeof box?.id === 'string' && typeof box.name === 'string' && Array.isArray(box.cards) && box.cards.every(validCard))
}

// Compare card identities, including structure/format/translation changes. Old cards
// without IDs use their position; their movement cannot be reliably identified.
export function compareCards(oldBook: Book, current: Book) {
  const entries = (book: Book) => (book.doc.content ?? []).map((card: any, i: number) => [card.attrs?.cardId || `position:${i}`, { card, i }] as const)
  const before = new Map<string, { card: any; i: number }>(entries(oldBook))
  const after = new Map<string, { card: any; i: number }>(entries(current))
  let added = 0, removed = 0, changed = 0, moved = 0
  for (const [id, value] of after) {
    const previous = before.get(id)
    if (!previous) added++
    else {
      if (JSON.stringify(previous.card) !== JSON.stringify(value.card) || JSON.stringify(oldBook.translations?.[id]) !== JSON.stringify(current.translations?.[id])) changed++
      if (previous.i !== value.i) moved++
    }
  }
  for (const id of before.keys()) if (!after.has(id)) removed++
  return { added, removed, changed, moved }
}

export type TextChange = { kind: 'same' | 'added' | 'removed'; text: string }
export function compareText(before: string, after: string): TextChange[] {
  const a = before.split('\n\n'), b = after.split('\n\n')
  // Bound comparison work for long manuscripts. Preserve all text even when
  // falling back to a larger replacement block instead of fine paragraph matches.
  if (a.length * b.length > 250000) {
    let start = 0, end = 0
    while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++
    while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++
    return [
      ...a.slice(0, start).map(text => ({ kind: 'same' as const, text })),
      ...a.slice(start, a.length - end).map(text => ({ kind: 'removed' as const, text })),
      ...b.slice(start, b.length - end).map(text => ({ kind: 'added' as const, text })),
      ...a.slice(a.length - end).map(text => ({ kind: 'same' as const, text })),
    ]
  }
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1])
  const result: TextChange[] = []; let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: 'same', text: a[i++] }); j++ }
    else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) result.push({ kind: 'removed', text: a[i++] })
    else result.push({ kind: 'added', text: b[j++] })
  }
  return result
}
