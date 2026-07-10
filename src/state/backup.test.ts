import { describe, it, expect } from 'vitest'
import {
  exportLibrary,
  exportBook,
  exportUniversalBox,
  parseBackup,
  parseUniversalExport,
  mergeImported,
  mergeUniversalCards,
  sanitizeFilename,
} from './backup'
import { EMPTY_DOC, UNIVERSAL_BOX_ID, type Book, type Box, type Library } from './bookStore'

function book(id: string, title: string): Book {
  return { id, title, doc: structuredClone(EMPTY_DOC), boxes: [] }
}

function universalBox(cards: any[] = []): Box {
  return { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards }
}

function card(cardId: string, text: string) {
  return { type: 'card', attrs: { cardId }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
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

describe('backup — exportLibrary 包含 universalBox（全库备份不再遗漏通用盒子）', () => {
  it('exportLibrary 产出的 JSON 带 universalBox 字段，内容跟传入的一致', () => {
    const library: Library = { books: [book('b1', 'A')], activeBookId: 'b1', universalBox: universalBox([card('u1', '通用卡')]) }
    const json = exportLibrary(library, '2026-07-10T00:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(parsed.universalBox).toEqual(library.universalBox)
  })

  it('exportLibrary → parseBackup 往返：universalBox 原样还原', () => {
    const library: Library = { books: [book('b1', 'A')], activeBookId: null, universalBox: universalBox([card('u1', '通用卡'), card('u2', '第二张')]) }
    const json = exportLibrary(library, '2026-07-10T00:00:00.000Z')
    const result = parseBackup(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.universalBox).toEqual(library.universalBox)
  })

  it('parseBackup 对老备份文件（无 universalBox 字段）：books 照常解析，universalBox 缺失而不是报错', () => {
    const result = parseBackup(JSON.stringify({ format: 'card-writer-backup', version: 1, books: [book('b1', 'A')] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.universalBox).toBeUndefined()
  })
})

describe('backup — exportBook（单本书导出）', () => {
  it('产出跟 exportLibrary 同格式、但 books 只有这一本', () => {
    const b = book('b1', '这一本')
    const json = exportBook(b, '2026-07-10T00:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe('card-writer-backup')
    expect(parsed.version).toBe(1)
    expect(parsed.books).toEqual([b])
  })

  it('exportBook → parseBackup 能解析出正好一本书，且能被 mergeImported 并入现有库（走现有导入通道）', () => {
    const b = book('exported', '被导出的书')
    const json = exportBook(b, '2026-07-10T00:00:00.000Z')
    const result = parseBackup(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.books).toEqual([b])

    const current: Library = { books: [book('existing', '现有书')], activeBookId: 'existing', universalBox: universalBox() }
    const merged = mergeImported(current, result.books)
    expect(merged.books).toHaveLength(2)
    expect(merged.books.some((x) => x.id === 'existing')).toBe(true)
    expect(merged.books.some((x) => x.id === 'exported')).toBe(true)
  })
})

describe('backup — exportUniversalBox / parseUniversalExport（通用盒子单独备份）', () => {
  it('往返：cards 一致', () => {
    const box = universalBox([card('u1', '甲'), card('u2', '乙')])
    const json = exportUniversalBox(box, '2026-07-10T00:00:00.000Z')
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe('card-writer-universal')
    expect(parsed.version).toBe(1)
    expect(parsed.cards).toEqual(box.cards)

    const result = parseUniversalExport(json)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.cards).toEqual(box.cards)
  })

  it('parseUniversalExport 对乱码/形状不对 → {ok:false}，不抛出', () => {
    expect(() => parseUniversalExport('not json {{{')).not.toThrow()
    expect(parseUniversalExport('not json {{{').ok).toBe(false)
    expect(parseUniversalExport('{}').ok).toBe(false)
    expect(parseUniversalExport(JSON.stringify({ cards: 'nope' })).ok).toBe(false)
  })
})

describe('backup — mergeUniversalCards（通用盒子按 cardId 去重合并）', () => {
  it('无冲突：全部保留 + 追加', () => {
    const current = [card('c1', '现有')]
    const imported = [card('i1', '导入甲'), card('i2', '导入乙')]
    const merged = mergeUniversalCards(current, imported)
    expect(merged.map((c) => c.attrs.cardId)).toEqual(['c1', 'i1', 'i2'])
  })

  it('cardId 撞车：已存在的卡保留，撞车的导入卡被跳过（不产生重复，不覆盖现有内容）', () => {
    const current = [card('same', '现有内容')]
    const imported = [card('same', '导入内容，理应被丢弃')]
    const merged = mergeUniversalCards(current, imported)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(card('same', '现有内容'))
  })

  it('重复导入同一份备份两次：不堆出重复卡', () => {
    const current = [card('c1', '现有')]
    const imported = [card('i1', '导入甲')]
    const once = mergeUniversalCards(current, imported)
    const twice = mergeUniversalCards(once, imported)
    expect(twice).toHaveLength(2)
    expect(twice.map((c) => c.attrs.cardId)).toEqual(['c1', 'i1'])
  })

  it('不 mutate 传入的数组', () => {
    const current = [card('c1', '现有')]
    const imported = [card('i1', '导入')]
    mergeUniversalCards(current, imported)
    expect(current).toHaveLength(1)
    expect(imported).toHaveLength(1)
  })
})

describe('backup — sanitizeFilename', () => {
  it('替换文件名里的非法字符', () => {
    expect(sanitizeFilename('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })

  it('空字符串/纯非法字符 → 兜底 untitled', () => {
    expect(sanitizeFilename('')).toBe('untitled')
    expect(sanitizeFilename('   ')).toBe('untitled')
  })

  it('正常标题原样保留', () => {
    expect(sanitizeFilename('我的读书笔记')).toBe('我的读书笔记')
  })
})
