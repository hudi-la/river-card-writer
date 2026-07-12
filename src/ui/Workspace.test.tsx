import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Workspace } from './Workspace'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

describe('Workspace', () => {
  it('默认渲染单文档（viewKind doc）：能看到正文里的卡', async () => {
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [{ type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文内容' }] }] }],
    })
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')).toBeTruthy()
    expect(container.textContent).toContain('正文内容')
  })

  it('点"＋ 新盒子"后 store.boxes +1，并切到盒子视图', async () => {
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    expect(useBookStore.getState().activeBook()!.boxes.length).toBe(0)
    await userEvent.click(screen.getByText('＋ 新盒子'))
    const boxes = useBookStore.getState().activeBook()!.boxes
    expect(boxes.length).toBe(1)
    expect(useBookStore.getState().viewKind).toBe('box')
  })

  it('顶部显示当前书标题', async () => {
    useBookStore.getState().renameBook(useBookStore.getState().library.activeBookId!, '我的书')
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('我的书')).toBeTruthy()
  })

  it('点击书名进入编辑态，输入新标题回车后调用 renameBook(activeBookId, newTitle)', async () => {
    const bookId = useBookStore.getState().library.activeBookId!
    useBookStore.getState().renameBook(bookId, '旧标题')
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByText('旧标题'))
    const input = screen.getByDisplayValue('旧标题') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '新标题{Enter}')
    // 直接断言 store 里真的落了新标题——比 spy 调用参数更贴近用户可见的结果，
    // 也不受"store action 引用被 vi.spyOn 污染后跨用例残留"这类测试基础设施
    // 坑的影响。
    expect(useBookStore.getState().library.books.find((b) => b.id === bookId)?.title).toBe('新标题')
    expect(screen.getByText('新标题')).toBeTruthy()
  })

  it('标题改为空白（trim 后为空）不保存，标题维持不变', async () => {
    const bookId = useBookStore.getState().library.activeBookId!
    useBookStore.getState().renameBook(bookId, '旧标题')
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByText('旧标题'))
    const input = screen.getByDisplayValue('旧标题') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '   {Enter}')
    expect(useBookStore.getState().library.books.find((b) => b.id === bookId)?.title).toBe('旧标题')
    expect(screen.getByText('旧标题')).toBeTruthy()
  })
})
