import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bookshelf } from './Bookshelf'
import { useBookStore, EMPTY_DOC, UNIVERSAL_BOX_ID } from '../state/bookStore'

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

describe('Bookshelf', () => {
  it('library 里两本书（标题 A/B）→ 渲染出两张书卡，显示各自标题', () => {
    useBookStore.setState({
      library: {
        books: [
          { id: 'b1', title: 'A', doc: EMPTY_DOC, boxes: [] },
          { id: 'b2', title: 'B', doc: EMPTY_DOC, boxes: [] },
        ],
        activeBookId: null,
        universalBox: { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] },
      },
    })
    render(<Bookshelf />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
    expect(document.querySelectorAll('.book-card').length).toBe(2)
  })

  it('点"＋ 新书"：books+1，且 shell 变为 book，新书成为 activeBook', async () => {
    const before = useBookStore.getState().library.books.length
    render(<Bookshelf />)
    await userEvent.click(screen.getByText('＋ 新书'))
    const s = useBookStore.getState()
    expect(s.library.books.length).toBe(before + 1)
    expect(s.shell).toBe('book')
    expect(s.activeBook()).toBeDefined()
  })

  it('点某张书卡的封面 → openBook 该书，shell 变为 book', async () => {
    const book = useBookStore.getState().addBook('目标书')
    render(<Bookshelf />)
    // 标题文字自己挡住了单击冒泡（留给双击改名），要开书得点卡片其余部分，比如封面。
    const card = screen.getByText('目标书').closest('.book-card')!
    await userEvent.click(card.querySelector('.book-cover')!)
    const s = useBookStore.getState()
    expect(s.shell).toBe('book')
    expect(s.activeBook()?.id).toBe(book.id)
  })

  it('空书柜显示提示，而不是空白', () => {
    useBookStore.setState({
      library: { books: [], activeBookId: null, universalBox: { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] } },
    })
    render(<Bookshelf />)
    expect(screen.getByText(/书柜还是空的/)).toBeTruthy()
  })

  it('书卡网格下方渲染通用盒子入口，显示名称与张数，点击后 openUniversalBox 且 shell 变为 universal', async () => {
    render(<Bookshelf />)
    expect(screen.getByText('通用盒子')).toBeTruthy()
    expect(screen.getByText('0 张')).toBeTruthy()
    await userEvent.click(screen.getByText('通用盒子'))
    expect(useBookStore.getState().shell).toBe('universal')
  })

  it('通用盒子入口显示的张数跟着 library.universalBox.cards 走', () => {
    useBookStore.setState({
      library: { ...useBookStore.getState().library, universalBox: { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [{}, {}] } },
    })
    render(<Bookshelf />)
    expect(screen.getByText('2 张')).toBeTruthy()
  })

  it('每张书卡有一个"导出这本书"按钮，点击触发一次下载，且不打开这本书（不冒泡到卡片）', async () => {
    const book = useBookStore.getState().addBook('目标书')
    render(<Bookshelf />)
    const card = screen.getByText('目标书').closest('.book-card')!
    const exportBtn = card.querySelector('.book-export') as HTMLButtonElement
    expect(exportBtn).toBeTruthy()

    await userEvent.click(exportBtn)

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    // 没有触发 openBook：shell 仍是 shelf，activeBookId 未指向这本书
    expect(useBookStore.getState().shell).toBe('shelf')
    expect(useBookStore.getState().library.activeBookId).not.toBe(book.id)
  })
})
