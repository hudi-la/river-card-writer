import { nanoid } from 'nanoid'
import type { Book, Library } from './bookStore'

export const BACKUP_FORMAT = 'card-writer-backup'
export const BACKUP_VERSION = 1

export function exportLibrary(library: Library, exportedAt: string = new Date().toISOString()): string {
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    books: library.books,
  }
  return JSON.stringify(payload, null, 2)
}

function looksLikeBook(b: any): b is Book {
  return b && typeof b === 'object' && typeof b.id === 'string' && typeof b.title === 'string' && b.doc != null && typeof b.doc === 'object'
}

export type ParseBackupResult = { ok: true; books: Book[] } | { ok: false; error: string }

// 永不抛出：所有失败路径都收敛成 {ok:false, error}，调用方（UI）不需要 try/catch。
export function parseBackup(text: string): ParseBackupResult {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '备份文件格式不对：期望一个对象' }
  }
  if (!Array.isArray(data.books)) {
    return { ok: false, error: '备份文件里没有找到 books 列表' }
  }
  if (!data.books.every(looksLikeBook)) {
    return { ok: false, error: '备份文件里有书缺少必要字段（id/title/doc）' }
  }

  return { ok: true, books: data.books as Book[] }
}

// 只增不减：保留 current 的每一本书，把 imported 追加进去；id 撞车时给 imported
// 那本换一个新 id（而不是覆盖/丢弃任何一方）。绝不 mutate 传入的 current。
export function mergeImported(current: Library, importedBooks: Book[]): Library {
  const existingIds = new Set(current.books.map((b) => b.id))
  const appended: Book[] = []
  for (const b of importedBooks) {
    if (existingIds.has(b.id)) {
      const freshId = nanoid()
      appended.push({ ...b, id: freshId })
      existingIds.add(freshId)
    } else {
      appended.push(b)
      existingIds.add(b.id)
    }
  }
  return { books: [...current.books, ...appended], activeBookId: current.activeBookId }
}
