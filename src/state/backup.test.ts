import { describe, it, expect } from 'vitest'
import { exportLibrary, parseBackup, mergeImported } from './backup'
import { EMPTY_DOC, type Book, type Library } from './bookStore'

function book(id: string, title: string): Book {
  return { id, title, doc: structuredClone(EMPTY_DOC), boxes: [] }
}

describe('backup — exportLibrary', () => {
  it('产出带 format/version/exportedAt/books 的美化 JSON 字符串', () => {
    const library: Library = { books: [book('b1', 'A'), book('b2', 'B')], activeBookId: 'b1' }
    const json = exportLibrary(library, '2026-07-09T00:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe('card-writer-backup')
    expect(parsed.version).toBe(1)
    expect(parsed.exportedAt).toBe('2026-07-09T00:00:00.000Z')
    expect(parsed.books).toEqual(library.books)
    // pretty-printed（带缩进换行），不是一行压死的 JSON
    expect(json).toContain('\n')
  })
})

describe('backup — parseBackup', () => {
  it('exportLibrary → parseBackup 往返，books 一致', () => {
    const library: Library = { books: [book('b1', 'A'), book('b2', 'B')], activeBookId: null }
    const json = exportLibrary(library, '2026-07-09T00:00:00.000Z')
    const result = parseBackup(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.books).toEqual(library.books)
  })

  it('乱码字符串 → {ok:false}，不抛出', () => {
    expect(() => parseBackup('not json at all {{{')).not.toThrow()
    const result = parseBackup('not json at all {{{')
    expect(result.ok).toBe(false)
  })

  it('合法 JSON 但形状不对（{}）→ {ok:false}，不抛出', () => {
    const result = parseBackup('{}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(typeof result.error).toBe('string')
  })

  it('合法 JSON 但是字符串字面量（"notjson"）→ {ok:false}，不抛出', () => {
    expect(() => parseBackup('"notjson"')).not.toThrow()
    const result = parseBackup('"notjson"')
    expect(result.ok).toBe(false)
  })

  it('books 数组里的元素缺 id/title/doc → {ok:false}', () => {
    const result = parseBackup(JSON.stringify({ format: 'card-writer-backup', version: 1, books: [{ title: 'no id' }] }))
    expect(result.ok).toBe(false)
  })

  it('books 不是数组 → {ok:false}', () => {
    const result = parseBackup(JSON.stringify({ format: 'card-writer-backup', version: 1, books: 'nope' }))
    expect(result.ok).toBe(false)
  })
})

describe('backup — mergeImported', () => {
  it('保留全部当前书 + 追加导入的书（无冲突）', () => {
    const current: Library = { books: [book('c1', '当前A')], activeBookId: 'c1' }
    const imported = [book('i1', '导入A'), book('i2', '导入B')]
    const merged = mergeImported(current, imported)
    expect(merged.books).toHaveLength(3)
    expect(merged.books.map((b) => b.id)).toEqual(['c1', 'i1', 'i2'])
    expect(merged.activeBookId).toBe('c1')
  })

  it('id 冲突：导入书重新分配 id，两本都保留，当前书原样不变', () => {
    const current: Library = { books: [book('same-id', '当前')], activeBookId: 'same-id' }
    const imported = [book('same-id', '导入')]
    const merged = mergeImported(current, imported)
    expect(merged.books).toHaveLength(2)
    // 当前书字节级不变
    expect(merged.books[0]).toEqual(book('same-id', '当前'))
    // 导入书标题保留，但 id 换掉了，不再和当前冲突
    const importedResult = merged.books[1]
    expect(importedResult.title).toBe('导入')
    expect(importedResult.id).not.toBe('same-id')
    expect(merged.books.map((b) => b.id).filter((id) => id === 'same-id')).toHaveLength(1)
  })

  it('不修改/不删除当前书（不 mutate 原 current.books 数组或其元素）', () => {
    const currentBooks = [book('c1', '当前A')]
    const current: Library = { books: currentBooks, activeBookId: 'c1' }
    const imported = [book('c1', '导入撞车')]
    const merged = mergeImported(current, imported)
    expect(current.books).toBe(currentBooks)
    expect(current.books).toHaveLength(1)
    expect(current.books[0].id).toBe('c1')
    expect(merged).not.toBe(current)
    expect(merged.books).not.toBe(current.books)
  })

  it('activeBookId 保持不变', () => {
    const current: Library = { books: [book('c1', '当前')], activeBookId: null }
    const merged = mergeImported(current, [book('i1', '导入')])
    expect(merged.activeBookId).toBeNull()
  })
})
