import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackupControls } from './BackupControls'
import { useBookStore, EMPTY_DOC } from '../state/bookStore'
import { exportLibrary } from '../state/backup'

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
    expect(screen.getByText('⬇ 导出备份')).toBeTruthy()
    expect(screen.getByText('⬆ 从备份导入')).toBeTruthy()
  })

  it('点导出：创建 blob URL、触发一次下载，并给出成功提示', async () => {
    useBookStore.setState({
      library: { books: [{ id: 'b1', title: 'A', doc: EMPTY_DOC, boxes: [] }], activeBookId: null },
    })
    render(<BackupControls />)
    await userEvent.click(screen.getByText('⬇ 导出备份'))
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
})
