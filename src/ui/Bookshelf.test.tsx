import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bookshelf } from './Bookshelf'
import { useBookStore, EMPTY_DOC } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
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
    useBookStore.setState({ library: { books: [], activeBookId: null } })
    render(<Bookshelf />)
    expect(screen.getByText(/书柜还是空的/)).toBeTruthy()
  })
})
