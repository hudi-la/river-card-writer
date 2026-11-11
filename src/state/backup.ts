
import type { Book, Box, Library } from './bookStore'

export const BACKUP_FORMAT = 'card-writer-backup'
export const BACKUP_VERSION = 1
export const UNIVERSAL_EXPORT_FORMAT = 'card-writer-universal'
export const UNIVERSAL_EXPORT_VERSION = 1

// 文件名兜底：去掉在 Windows/macOS 文件系统里会出问题的字符，避免下载失败或
// 落地成意外的路径分隔。空标题/全是非法字符时兜底成 'untitled'，而不是产出一个
// 空文件名。
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || 'untitled'
}

export function exportLibrary(library: Library, exportedAt: string = new Date().toISOString()): string {
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    books: library.books,
    universalBoxes: library.universalBoxes,
  }
  return JSON.stringify(payload, null, 2)
}

// 单本书的备份：跟全库备份同一种格式（books: [book]），所以能原样走现有的
// "从备份导入" 入口——不需要新的导入通道，mergeImported 会把它当成一本书追加进库。
export function exportBook(book: Book, exportedAt: string = new Date().toISOString()): string {
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    books: [book],
  }
  return JSON.stringify(payload, null, 2)
}

export function exportUniversalBox(universalBox: Box, exportedAt: string = new Date().toISOString()): string {
  const payload = {
    format: UNIVERSAL_EXPORT_FORMAT,
    version: UNIVERSAL_EXPORT_VERSION,
    exportedAt,
    cards: universalBox.cards,
  }
  return JSON.stringify(payload, null, 2)
}

function looksLikeBook(b: any): b is Book {
  return b && typeof b === 'object' && typeof b.id === 'string' && typeof b.title === 'string' && b.doc != null && typeof b.doc === 'object'
}

function looksLikeBox(b: any): b is Box {
  return b && typeof b === 'object' && typeof b.id === 'string' && typeof b.name === 'string' && Array.isArray(b.cards)
}

function looksLikeBoxArray(arr: any): arr is Box[] {
  return Array.isArray(arr) && arr.every(looksLikeBox)
}

export type ParseBackupResult = { ok: true; books: Book[]; universalBoxes?: Box[] } | { ok: false; error: string }

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

  // universalBoxes 是可选字段：老备份文件（Phase 11 之前导出的）没有它，缺失时
  // 不算错——调用方按"未包含通用盒子"处理，绝不因为老文件缺一个新字段就整体拒绝。
  // Phase 14 起支持多个通用盒子（数组）；老格式（Phase 14 之前）只有单个
  // universalBox 字段——识别到就包成单元素数组，老备份依然能正常导入，一张
  // 卡都不丢（DATA-SAFETY）。两个字段都有时以新的 universalBoxes 为准。
  const result: ParseBackupResult = { ok: true, books: data.books as Book[] }
  if (looksLikeBoxArray(data.universalBoxes)) {
    result.universalBoxes = data.universalBoxes as Box[]
  } else if (looksLikeBox(data.universalBox)) {
    result.universalBoxes = [data.universalBox as Box]
  }
  return result
}

export type ParseUniversalResult = { ok: true; cards: any[] } | { ok: false; error: string }

// 永不抛出，跟 parseBackup 同一套约定。
export function parseUniversalExport(text: string): ParseUniversalResult {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '备份文件格式不对：期望一个对象' }
  }
  if (!Array.isArray(data.cards)) {
    return { ok: false, error: '备份文件里没有找到 cards 列表' }
  }

  return { ok: true, cards: data.cards }
}

// 只增不减：保留 current 的每一本书，把 imported 追加进去；id 撞车时给 imported
// 那本换一个新 id（而不是覆盖/丢弃任何一方）。绝不 mutate 传入的 current。
export function mergeImported(current: Library, importedBooks: Book[]): Library {
  const existingIds = new Set(current.books.map((b) => b.id))
  const appended: Book[] = []
  for (const b of importedBooks) {
    if (existingIds.has(b.id)) {
      const freshId = crypto.randomUUID()
      appended.push({ ...b, id: freshId })
      existingIds.add(freshId)
    } else {
      appended.push(b)
      existingIds.add(b.id)
    }
  }
  return { books: [...current.books, ...appended], activeBookId: current.activeBookId }
}

// 只增不减，专治通用盒子：按 attrs.cardId 去重——已存在的卡原样保留，只追加
// current 里还没有的卡；重复导入同一份备份不会堆出重复卡。没有 cardId 的卡
// （理论上不该出现，但别因此丢卡）一律当作"新卡"追加。绝不 mutate 传入的数组。
export function mergeUniversalCards(currentCards: any[], importedCards: any[]): any[] {
  const existingIds = new Set(currentCards.map((c) => c?.attrs?.cardId).filter((id) => id != null))
  const appended: any[] = []
  for (const card of importedCards) {
    const cardId = card?.attrs?.cardId
    if (cardId != null && existingIds.has(cardId)) continue
    appended.push(card)
    if (cardId != null) existingIds.add(cardId)
  }
  return [...currentCards, ...appended]
}

// 只增不减，专治"多个通用盒子"（Phase 14 Task 4）：按 id 匹配——current 里已有的
// 盒子，用 mergeUniversalCards 按 cardId 去重合并 imported 那份同 id 盒子的卡
// （不改盒子的 name，current 的名字优先，不被导入文件覆盖）；current 里没有的
// 盒子（imported 独有的 id，比如从另一台设备带过来的新盒子）整只追加。current
// 独有的盒子原样保留。不 mutate 任何传入数组。
export function mergeUniversalBoxes(currentBoxes: Box[], importedBoxes: Box[]): Box[] {
  const currentIds = new Set(currentBoxes.map((b) => b.id))
  const merged = currentBoxes.map((b) => {
    const imported = importedBoxes.find((ib) => ib.id === b.id)
    if (!imported) return b
    return { ...b, cards: mergeUniversalCards(b.cards, imported.cards) }
  })
  const newBoxes = importedBoxes.filter((ib) => !currentIds.has(ib.id))
  return [...merged, ...newBoxes]
}
