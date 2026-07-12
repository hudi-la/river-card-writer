import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
        universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }],
      },
    })
    render(<Bookshelf />)
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText('B')).toBeTruthy()
    expect(document.querySelectorAll('.book-card').length).toBe(3) // 两张书卡 + "＋ 新书" 那一格
  })

  it('"＋ 新书" 挪到书卡旁边：跟书卡同在 .shelf-grid 里', async () => {
    const before = useBookStore.getState().library.books.length
    render(<Bookshelf />)
    const addTile = screen.getByText('＋ 新书')
    expect(addTile.closest('.shelf-grid')).toBeTruthy()
    await userEvent.click(addTile)
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

  it('空书柜（无书）仍显示"＋ 新书"，并额外显示提示语', () => {
    useBookStore.setState({
      library: { books: [], activeBookId: null, universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }] },
    })
    render(<Bookshelf />)
    expect(screen.getByText('＋ 新书')).toBeTruthy()
    expect(screen.getByText(/书柜还是空的/)).toBeTruthy()
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

  describe('通用盒子（Phase 14 Task 4）', () => {
    it('列出 library.universalBoxes 里的所有通用盒子，各自显示名称与张数', () => {
      useBookStore.getState().addUniversalBox('灵感')
      render(<Bookshelf />)
      expect(screen.getByText('通用盒子')).toBeTruthy()
      expect(screen.getByText('灵感')).toBeTruthy()
      expect(screen.getAllByText('0 张')).toHaveLength(2)
    })

    it('通用盒子入口显示的张数跟着该盒子的 cards 走', () => {
      useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, { type: 'card', attrs: { cardId: 'u1' }, content: [] })
      useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, { type: 'card', attrs: { cardId: 'u2' }, content: [] })
      render(<Bookshelf />)
      expect(screen.getByText('2 张')).toBeTruthy()
    })

    it('点"＋ 新通用盒子"：universalBoxes +1，且新盒子出现在列表里', async () => {
      const before = useBookStore.getState().library.universalBoxes.length
      render(<Bookshelf />)
      await userEvent.click(screen.getByText('＋ 新通用盒子'))
      expect(useBookStore.getState().library.universalBoxes.length).toBe(before + 1)
    })

    it('双击某通用盒子的名字：进入改名态，输入新名字回车后 renameUniversalBox 生效', async () => {
      render(<Bookshelf />)
      const nameEl = screen.getByText('通用盒子')
      await userEvent.dblClick(nameEl)
      const input = document.querySelector('.universal-box-name-edit') as HTMLInputElement
      expect(input).toBeTruthy()
      await userEvent.clear(input)
      await userEvent.type(input, '新名字{Enter}')
      expect(useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)?.name).toBe('新名字')
      expect(screen.getByText('新名字')).toBeTruthy()
    })

    it('点击某通用盒子入口（非标题文字）：打开该盒子的悬浮大窗，展示它的卡片；插入按钮禁用（书柜没有当前 doc）', async () => {
      useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, {
        type: 'card',
        attrs: { cardId: 'u1' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '通用卡内容' }] }],
      })
      render(<Bookshelf />)
      const entry = screen.getByText('通用盒子').closest('.universal-box-entry')!
      await userEvent.click(within(entry).getByText(/张/))
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('通用卡内容')).toBeTruthy()
      const insertBtn = screen.getByText('⤵ 插入正文') as HTMLButtonElement
      expect(insertBtn.disabled).toBe(true)
    })

    it('关闭悬浮大窗（Esc）：dialog 消失', async () => {
      render(<Bookshelf />)
      const entry = screen.getByText('通用盒子').closest('.universal-box-entry')!
      await userEvent.click(within(entry).getByText(/张/))
      expect(screen.getByRole('dialog')).toBeTruthy()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
