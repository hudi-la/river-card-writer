import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeftNav } from './LeftNav'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

describe('LeftNav', () => {
  it('双击章名可改名', async () => {
    render(<LeftNav />)
    const chap = screen.getByText('第一章')
    await userEvent.dblClick(chap)
    const input = screen.getByDisplayValue('第一章')
    await userEvent.clear(input)
    await userEvent.type(input, '离岸{Enter}')
    expect(useBookStore.getState().book.chapters[0].title).toBe('离岸')
  })

  it('单击仍然只是切换 active，不进入编辑态', async () => {
    useBookStore.getState().addChapter('第二章')
    render(<LeftNav />)
    const second = screen.getByText('第二章')
    await userEvent.click(second)
    expect(useBookStore.getState().activeChapterId).toBe(useBookStore.getState().book.chapters[1].id)
    expect(screen.queryByDisplayValue('第二章')).toBeNull()
  })

  it('Escape 取消改名：输入草稿后按 Escape，store 里仍是原标题（不会被卸载时的 blur 悄悄存回）', async () => {
    render(<LeftNav />)
    const chap = screen.getByText('第一章')
    await userEvent.dblClick(chap)
    const input = screen.getByDisplayValue('第一章')
    await userEvent.clear(input)
    await userEvent.type(input, '未提交的草稿')
    await userEvent.keyboard('{Escape}')
    expect(useBookStore.getState().book.chapters[0].title).toBe('第一章')
    expect(screen.queryByDisplayValue('未提交的草稿')).toBeNull()
  })

  it('单击章后 openChapter 生效：viewKind 回到 chapter（回归：不是老的 setActiveChapter）', async () => {
    useBookStore.getState().addBox('盒子甲')
    useBookStore.setState({ viewKind: 'box' })
    render(<LeftNav />)
    await userEvent.click(screen.getByText('第一章'))
    expect(useBookStore.getState().viewKind).toBe('chapter')
    expect(useBookStore.getState().activeChapterId).toBe(useBookStore.getState().book.chapters[0].id)
  })

  it('渲染后能看到"章"与"盒子"两个分组标题', () => {
    render(<LeftNav />)
    expect(screen.getByText('章')).toBeTruthy()
    expect(screen.getByText('盒子')).toBeTruthy()
  })

  it('点"＋ 新盒子"后 store.boxes +1，并进入该盒子', async () => {
    render(<LeftNav />)
    expect(useBookStore.getState().book.boxes.length).toBe(0)
    await userEvent.click(screen.getByText('＋ 新盒子'))
    const boxes = useBookStore.getState().book.boxes
    expect(boxes.length).toBe(1)
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(boxes[0].id)
  })

  it('点某盒子后 viewKind 变为 box，且该盒子被记为 active', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    render(<LeftNav />)
    await userEvent.click(screen.getByText('素材盒'))
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(box.id)
  })
})
