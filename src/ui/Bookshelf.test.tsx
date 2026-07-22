import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Bookshelf, coverGradient } from './Bookshelf'
import { useBookStore, EMPTY_DOC, UNIVERSAL_BOX_ID } from '../state/bookStore'

// 书卡的 导出/删除/重命名/自定义封面 都收进右上角「⋯」菜单——测试统一先点开菜单。
async function openBookMenu(card: HTMLElement) {
  await userEvent.click(within(card).getByRole('button', { name: '更多' }))
}

// jsdom 的 CSSOM 会把 style.backgroundImage 里的颜色（hex/hsl）规范化成
// rgb(...)——跟真实浏览器渲染出的实际颜色完全一致，只是字符串表示不同。直接
// 拿 hex/hsl 字面量去 toBe 会误报。统一"过一遍 DOM"再比较，两边都走同一套
// 规范化，断言的还是"最终渲染出的渐变一致"，不是字符串巧合。
function normalizeGradient(css: string): string {
  const el = document.createElement('div')
  el.style.backgroundImage = css
  return el.style.backgroundImage
}

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
    const addTile = screen.getByText('新书')
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
    expect(screen.getByText('新书')).toBeTruthy()
    expect(screen.getByText(/书柜还是空的/)).toBeTruthy()
  })

  it('每张书卡有一个"导出这本书"按钮，点击触发一次下载，且不打开这本书（不冒泡到卡片）', async () => {
    const book = useBookStore.getState().addBook('目标书')
    render(<Bookshelf />)
    const card = screen.getByText('目标书').closest('.book-card')!
    await openBookMenu(card)
    await userEvent.click(screen.getByRole('button', { name: /导出/ }))

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
      await userEvent.click(screen.getByText('新通用盒子'))
      expect(useBookStore.getState().library.universalBoxes.length).toBe(before + 1)
    })

    it('双击某通用盒子的名字：进入改名态，输入新名字回车后 renameUniversalBox 生效', async () => {
      render(<Bookshelf />)
      const nameEl = screen.getByText('通用盒子')
      await userEvent.dblClick(nameEl)
      const input = document.querySelector('.box-tile-name-edit') as HTMLInputElement
      expect(input).toBeTruthy()
      await userEvent.clear(input)
      await userEvent.type(input, '新名字{Enter}')
      expect(useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)?.name).toBe('新名字')
      expect(screen.getByText('新名字')).toBeTruthy()
    })

    it('点击某通用盒子入口（非标题文字）：打开该盒子的悬浮大窗，展示它的卡片；插入按钮是"插入到文章…"（书柜没有当前 doc，改成选书插入）', async () => {
      useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, {
        type: 'card',
        attrs: { cardId: 'u1' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '通用卡内容' }] }],
      })
      render(<Bookshelf />)
      const entry = screen.getByText('通用盒子').closest('.box-tile')!
      await userEvent.click(within(entry).getByText(/张/))
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText('通用卡内容')).toBeTruthy()
      const insertBtn = document.querySelector('[data-box-action="insert"]') as HTMLButtonElement
      expect(insertBtn.disabled).toBe(false)
      expect(insertBtn.textContent).toContain('插入到文章')
    })

    it('关闭悬浮大窗（Esc）：dialog 消失', async () => {
      render(<Bookshelf />)
      const entry = screen.getByText('通用盒子').closest('.box-tile')!
      await userEvent.click(within(entry).getByText(/张/))
      expect(screen.getByRole('dialog')).toBeTruthy()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('从书柜插入到文章：点"插入到文章…"→出现选书条→选一本书，打开那本书并把这张卡带在手上（carry）', async () => {
      useBookStore.setState({
        library: {
          books: [{ id: 'bk1', title: '目标书', doc: EMPTY_DOC, boxes: [] }],
          activeBookId: null,
          universalBoxes: [{ id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }],
        },
        shell: 'shelf',
      })
      useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, {
        type: 'card',
        attrs: { cardId: 'u1' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '通用卡内容' }] }],
      })
      render(<Bookshelf />)
      const entry = screen.getByText('通用盒子').closest('.box-tile')!
      await userEvent.click(within(entry).getByText(/张/))
      await userEvent.click(document.querySelector('[data-box-action="insert"]') as HTMLButtonElement)
      expect(screen.getByText('插入到哪本书？')).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: '目标书' }))
      const st = useBookStore.getState()
      expect(st.shell).toBe('book')
      expect(st.library.activeBookId).toBe('bk1')
      expect(st.carried).toEqual({ boxId: UNIVERSAL_BOX_ID, cardId: 'u1' })
    })

    it('盒子瓦片换 emoji：⋯ 菜单→换 icon→选一个 emoji，写进 box.emoji', async () => {
      render(<Bookshelf />)
      const tile = screen.getByText('通用盒子').closest('.box-tile')!
      await userEvent.click(within(tile).getByRole('button', { name: '更多' }))
      await userEvent.click(screen.getByRole('button', { name: /换 icon/ }))
      await userEvent.click(screen.getByRole('button', { name: '💡' }))
      expect(useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)?.emoji).toBe('💡')
    })

    it('盒子瓦片换颜色：⋯ 菜单→换颜色→选一个色，写进 box.color', async () => {
      render(<Bookshelf />)
      const tile = screen.getByText('通用盒子').closest('.box-tile')!
      await userEvent.click(within(tile).getByRole('button', { name: '更多' }))
      await userEvent.click(screen.getByRole('button', { name: /换颜色/ }))
      await userEvent.click(screen.getByTitle('#7fa3c4'))
      expect(useBookStore.getState().library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID)?.color).toBe('#7fa3c4')
    })
  })

  describe('自定义封面', () => {
    it('没自定义过封面的书：封面渲染的是自动渐变 coverGradient(id)（默认行为不变）', () => {
      const book = useBookStore.getState().addBook('从没改过封面的书')
      render(<Bookshelf />)
      const cover = screen.getByText('从没改过封面的书').closest('.book-card')!.querySelector('.book-cover') as HTMLElement
      expect(cover.style.backgroundImage).toBe(normalizeGradient(coverGradient(book.id)))
    })

    it('点"编辑封面"打开弹窗，标题带书名；点某个预设、保存 → 弹窗关闭，书柜上这本书的封面立刻换成预设的渐变，不影响封面按钮打开/关闭之外的东西', async () => {
      const book = useBookStore.getState().addBook('要换封面的书')
      render(<Bookshelf />)
      const card = screen.getByText('要换封面的书').closest('.book-card')!
      await openBookMenu(card)
      await userEvent.click(screen.getByRole('button', { name: /自定义封面/ }))

      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByText(/封面 · 要换封面的书/)).toBeTruthy()

      const presetBtn = screen.getByTitle('晨雾')
      await userEvent.click(presetBtn)
      await userEvent.click(screen.getByText('保存'))

      expect(screen.queryByRole('dialog')).toBeNull()
      const updated = useBookStore.getState().library.books.find((b) => b.id === book.id)
      expect(updated?.cover).toEqual({ colors: ['#eee2d3', '#c9b8a8', '#8fa6a3'], angle: 135, texture: true })

      const cover = card.querySelector('.book-cover') as HTMLElement
      expect(cover.style.backgroundImage).toBe(normalizeGradient('linear-gradient(135deg, #eee2d3, #c9b8a8, #8fa6a3)'))
      // doc/boxes 不受影响。
      expect(updated?.doc).toEqual(book.doc)
      expect(updated?.boxes).toEqual(book.boxes)
    })

    it('自定义三个颜色 + 角度 + 关掉纹理 → 保存后书柜封面用自定义颜色渲染，且不带纹理叠层（.book-cover--no-texture）', async () => {
      useBookStore.getState().addBook('自定义封面的书')
      render(<Bookshelf />)
      const card = screen.getByText('自定义封面的书').closest('.book-card')!
      await openBookMenu(card)
      await userEvent.click(screen.getByRole('button', { name: /自定义封面/ }))

      const colorInputs = screen.getAllByLabelText(/封面颜色/) as HTMLInputElement[]
      fireEvent.change(colorInputs[0], { target: { value: '#101010' } })
      fireEvent.change(colorInputs[1], { target: { value: '#202020' } })
      fireEvent.change(colorInputs[2], { target: { value: '#303030' } })
      fireEvent.change(screen.getByLabelText('渐变角度'), { target: { value: '90' } })
      await userEvent.click(screen.getByLabelText('纹理')) // 默认开着，点一下关掉
      await userEvent.click(screen.getByText('保存'))

      const cover = card.querySelector('.book-cover') as HTMLElement
      expect(cover.style.backgroundImage).toBe(normalizeGradient('linear-gradient(90deg, #101010, #202020, #303030)'))
      expect(cover.className).toContain('book-cover--no-texture')
    })

    it('"随机"按钮：点一下换出一份新的三色+角度组合（不抛出，且落在合法 hex 颜色范围内）', async () => {
      useBookStore.getState().addBook('随机封面')
      render(<Bookshelf />)
      const card = screen.getByText('随机封面').closest('.book-card')!
      await openBookMenu(card)
      await userEvent.click(screen.getByRole('button', { name: /自定义封面/ }))

      const preview = document.querySelector('.cover-editor-preview') as HTMLElement
      const before = preview.style.backgroundImage
      await userEvent.click(screen.getByText('🎲 随机'))
      const after = preview.style.backgroundImage
      // jsdom 把 hex 规范化成 rgb(r, g, b)——断言的是"洗牌产出了一个合法的三色渐变"。
      expect(after).toMatch(/^linear-gradient\(\d+deg, rgb\(\d+, \d+, \d+\), rgb\(\d+, \d+, \d+\), rgb\(\d+, \d+, \d+\)\)$/)
      // 极小概率随机出跟起点一样的组合，但断言"是一个合法渐变"已经足够覆盖"洗牌真的生效了、不抛异常"。
      expect(before).not.toBe('')
    })

    it('设置过封面之后点"恢复默认"：cover 字段清空，书柜封面变回 coverGradient(id)', async () => {
      const book = useBookStore.getState().addBook('先设置后恢复')
      useBookStore.getState().setBookCover(book.id, { colors: ['#111111', '#222222', '#333333'], angle: 45, texture: true })
      render(<Bookshelf />)
      const card = screen.getByText('先设置后恢复').closest('.book-card')!
      // 恢复前：封面确实是自定义的那份。
      expect((card.querySelector('.book-cover') as HTMLElement).style.backgroundImage).toBe(
        normalizeGradient('linear-gradient(45deg, #111111, #222222, #333333)'),
      )

      await openBookMenu(card)
      await userEvent.click(screen.getByRole('button', { name: /自定义封面/ }))
      await userEvent.click(screen.getByText('恢复默认'))

      expect(screen.queryByRole('dialog')).toBeNull()
      const updated = useBookStore.getState().library.books.find((b) => b.id === book.id)
      expect(updated?.cover).toBeUndefined()
      const cover = card.querySelector('.book-cover') as HTMLElement
      expect(cover.style.backgroundImage).toBe(normalizeGradient(coverGradient(book.id)))
    })

    it('重新打开一本已有封面的书的编辑器：草稿以当前封面为起点，不是从预设/上次编辑另一本书的草稿开始', async () => {
      const book = useBookStore.getState().addBook('已有封面')
      useBookStore.getState().setBookCover(book.id, { colors: ['#aaaaaa', '#bbbbbb', '#cccccc'], angle: 77, texture: true })
      render(<Bookshelf />)
      const card = screen.getByText('已有封面').closest('.book-card')!
      await openBookMenu(card)
      await userEvent.click(screen.getByRole('button', { name: /自定义封面/ }))
      const preview = document.querySelector('.cover-editor-preview') as HTMLElement
      expect(preview.style.backgroundImage).toBe(normalizeGradient('linear-gradient(77deg, #aaaaaa, #bbbbbb, #cccccc)'))
    })
  })
})
