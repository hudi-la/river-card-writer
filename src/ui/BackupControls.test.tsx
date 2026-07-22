import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackupControls } from './BackupControls'
import { useBookStore, EMPTY_DOC, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { exportLibrary } from '../state/backup'
import { pushSnapshot } from '../state/snapshots'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  // jsdom 没实现 URL.createObjectURL/revokeObjectURL，导出流程要用到，先垫一个假的。
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  })
})

describe('BackupControls', () => {
  it('渲染导出/导入两个按钮', () => {
    render(<BackupControls />)
    expect(screen.getByText('导出备份')).toBeTruthy()
    expect(screen.getByText('从备份导入')).toBeTruthy()
  })

  it('点导出：创建 blob URL、触发一次下载，并给出成功提示', async () => {
    useBookStore.setState({
      library: { books: [{ id: 'b1', title: 'A', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
    })
    render(<BackupControls />)
    await userEvent.click(screen.getByText('导出备份'))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/已导出 1 本书/)).toBeTruthy()
  })

  it('导入一份合法备份：books 追加进库，且不丢失现有书，显示"导入了 N 本书"', async () => {
    useBookStore.setState({
      library: { books: [{ id: 'existing', title: '现有书', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
    })
    const backupJson = exportLibrary(
      { books: [{ id: 'imported1', title: '导入书', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
      '2026-07-09T00:00:00.000Z'
    )
    const file = new File([backupJson], 'backup.json', { type: 'application/json' })

    render(<BackupControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入了 1 本书/)).toBeTruthy())
    const books = useBookStore.getState().library.books
    expect(books).toHaveLength(2)
    expect(books.some((b) => b.id === 'existing')).toBe(true)
    expect(books.some((b) => b.title === '导入书')).toBe(true)
  })

  it('导入损坏的文件：不改动 library，显示错误提示', async () => {
    useBookStore.setState({
      library: { books: [{ id: 'existing', title: '现有书', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
    })
    const file = new File(['not json {{{'], 'broken.json', { type: 'application/json' })

    render(<BackupControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入失败/)).toBeTruthy())
    const books = useBookStore.getState().library.books
    expect(books).toHaveLength(1)
    expect(books[0].id).toBe('existing')
  })

  it('id 撞车的备份：两本都保留，导入书拿到新 id', async () => {
    useBookStore.setState({
      library: { books: [{ id: 'same', title: '现有书', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
    })
    const backupJson = exportLibrary(
      { books: [{ id: 'same', title: '撞车的导入书', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
      '2026-07-09T00:00:00.000Z'
    )
    const file = new File([backupJson], 'backup.json', { type: 'application/json' })

    render(<BackupControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入了 1 本书/)).toBeTruthy())
    const books = useBookStore.getState().library.books
    expect(books).toHaveLength(2)
    expect(books.filter((b) => b.id === 'same')).toHaveLength(1)
    expect(books.find((b) => b.title === '现有书')?.id).toBe('same')
    expect(books.find((b) => b.title === '撞车的导入书')?.id).not.toBe('same')
  })

  it('全库导出包含通用盒子（data-safety 修复）：导出的 JSON 带 universalBoxes 数组字段', async () => {
    const cardJSON = { type: 'card', attrs: { cardId: 'u1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '通用卡' }] }] }
    useBookStore.setState({
      library: {
        books: [{ id: 'b1', title: 'A', doc: EMPTY_DOC, boxes: [] }],
        activeBookId: null,
        universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardJSON] }],
      },
    })
    render(<BackupControls />)
    await userEvent.click(screen.getByText('导出备份'))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    // 通过 mock 的 Blob 内容验证：createObjectURL 拿到的第一个参数是 Blob，读出它的文本核对 universalBoxes。
    const blobArg = (URL.createObjectURL as any).mock.calls[0][0] as Blob
    const text = await blobArg.text()
    const parsed = JSON.parse(text)
    expect(parsed.universalBoxes).toEqual([{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [cardJSON] }])
  })

  it('导入带 universalBoxes 的全库备份：按 id 非破坏性地合并进当前通用盒子（按 cardId 去重），并在提示里体现', async () => {
    const existingCard = { type: 'card', attrs: { cardId: 'kept' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '现有通用卡' }] }] }
    useBookStore.setState({
      library: {
        books: [{ id: 'existing', title: '现有书', doc: EMPTY_DOC, boxes: [] }],
        activeBookId: null,
        universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [existingCard] }],
      },
    })

    const importedCard = { type: 'card', attrs: { cardId: 'new1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '导入的通用卡' }] }] }
    const backupJson = exportLibrary(
      {
        books: [{ id: 'imported1', title: '导入书', doc: EMPTY_DOC, boxes: [] }],
        activeBookId: null,
        universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [importedCard] }],
      },
      '2026-07-10T00:00:00.000Z'
    )
    const file = new File([backupJson], 'backup.json', { type: 'application/json' })

    render(<BackupControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入了 1 本书/)).toBeTruthy())
    expect(screen.getByText(/个通用盒子共.*张卡已合并/)).toBeTruthy()

    const cards = useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)!.cards
    expect(cards).toHaveLength(2)
    expect(cards).toContainEqual(existingCard)
    expect(cards).toContainEqual(importedCard)
  })

  it('导入一份新的通用盒子（current 里不存在的 id）：整只追加，不影响已有的通用盒子', async () => {
    useBookStore.setState({
      library: {
        books: [{ id: 'existing', title: '现有书', doc: EMPTY_DOC, boxes: [] }],
        activeBookId: null,
        universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }],
      },
    })
    const newCard = { type: 'card', attrs: { cardId: 'n1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '新盒子的卡' }] }] }
    const backupJson = exportLibrary(
      {
        books: [],
        activeBookId: null,
        universalBoxes: [{ id: 'inspiration', name: '灵感', cards: [newCard] }],
      },
      '2026-07-10T00:00:00.000Z'
    )
    const file = new File([backupJson], 'backup.json', { type: 'application/json' })

    render(<BackupControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入了 0 本书/)).toBeTruthy())
    const boxes = useBookStore.getState().library.universalBoxes
    expect(boxes.find((b) => b.id === UNIVERSAL_BOX_ID)?.cards).toEqual([])
    expect(boxes.find((b) => b.id === 'inspiration')?.cards).toEqual([newCard])
  })

  it('导入老格式（单个 universalBox 字段）的全库备份：包成数组后照常合并进默认通用盒子', async () => {
    useBookStore.setState({
      library: {
        books: [{ id: 'existing', title: '现有书', doc: EMPTY_DOC, boxes: [] }],
        activeBookId: null,
        universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }],
      },
    })
    const oldCard = { type: 'card', attrs: { cardId: 'old1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '老格式导入的卡' }] }] }
    const oldFormatJson = JSON.stringify({
      format: 'card-writer-backup',
      version: 1,
      books: [],
      universalBox: { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [oldCard] },
    })
    const file = new File([oldFormatJson], 'old-backup.json', { type: 'application/json' })

    render(<BackupControls />)
    const input = document.querySelector('.backup-file-input') as HTMLInputElement
    await userEvent.upload(input, file)

    await waitFor(() => expect(screen.getByText(/导入了 0 本书/)).toBeTruthy())
    const cards = useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)!.cards
    expect(cards).toContainEqual(oldCard)
  })
})
