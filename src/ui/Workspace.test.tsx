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
    await userEvent.click(screen.getByText('新盒子'))
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

  it('默认显示目录；点开关能收起，再点回来', async () => {
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.rail')).toBeTruthy()

    await userEvent.click(screen.getByLabelText('收起目录'))
    expect(container.querySelector('.rail')).toBeNull()
    expect(container.querySelector('.app--no-nav')).toBeTruthy()

    await userEvent.click(screen.getByLabelText('打开目录'))
    expect(container.querySelector('.rail')).toBeTruthy()
  })

  it('复制整篇英文：跨卡收齐，段落之间空一行', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    })
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0', en: ['One.', 'Two.'] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
        { type: 'card', attrs: { cardId: 'c1', en: ['Three.'] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二段' }] }] },
      ],
    })
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    await userEvent.click(screen.getByLabelText('复制整篇英文'))
    expect(written).toEqual(['One.\n\nTwo.\n\nThree.'])
    // 复制成功后按钮自己说一声
    expect(screen.getByLabelText('整篇英文已复制')).toBeTruthy()
  })

  it('剪贴板被拦掉时说"复制失败"，不假装成功了', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('denied') } },
    })
    useBookStore.getState().updateDoc({
      type: 'doc',
      content: [{ type: 'card', attrs: { cardId: 'c0', en: ['One.'] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] }],
    })
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    await userEvent.click(screen.getByLabelText('复制整篇英文'))
    expect(screen.getByLabelText('复制失败')).toBeTruthy()
  })

  it('单语模式下不显示复制英文——那里没有英文', async () => {
    render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByLabelText('复制整篇英文')).toBeNull()
  })

  it('切到双语时目录自动收起——那时横向空间最紧张', async () => {
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    expect(container.querySelector('.rail')).toBeNull()
    expect(container.querySelector('.app--bilingual')).toBeTruthy()
  })

  it('双语里仍然能把目录叫回来——不能一关了之，作者还要跳章节', async () => {
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    await userEvent.click(screen.getByLabelText('打开目录'))
    expect(container.querySelector('.rail')).toBeTruthy()
    // 目录回来了，双语也还在
    expect(container.querySelector('.app--bilingual')).toBeTruthy()
  })

  it('退回单语时目录自动回来', async () => {
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    expect(container.querySelector('.rail')).toBeNull()
    await userEvent.click(screen.getByLabelText('回到单语'))
    expect(container.querySelector('.rail')).toBeTruthy()
  })

  it('进双语时备料边栏默认打开——那是双语模式的主要用途', async () => {
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    expect(container.querySelector('.prep-sidebar')).toBeTruthy()
  })

  it('关掉备料边栏后再进一次双语，它还是打开的——不记上一次的关闭', async () => {
    const { container } = render(<Workspace />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(screen.getByLabelText('中英并排'))
    await userEvent.click(screen.getByLabelText('收起备料'))
    expect(container.querySelector('.prep-sidebar')).toBeNull()

    await userEvent.click(screen.getByLabelText('回到单语'))
    await userEvent.click(screen.getByLabelText('中英并排'))
    expect(container.querySelector('.prep-sidebar')).toBeTruthy()
  })
})
