import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChapterRail } from './ChapterRail'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

describe('ChapterRail', () => {
  it('双击章名可改名', async () => {
    render(<ChapterRail />)
    const chap = screen.getByText('第一章')
    await userEvent.dblClick(chap)
    const input = screen.getByDisplayValue('第一章')
    await userEvent.clear(input)
    await userEvent.type(input, '离岸{Enter}')
    expect(useBookStore.getState().book.chapters[0].title).toBe('离岸')
  })

  it('单击仍然只是切换 active，不进入编辑态', async () => {
    useBookStore.getState().addChapter('第二章')
    render(<ChapterRail />)
    const second = screen.getByText('第二章')
    await userEvent.click(second)
    expect(useBookStore.getState().activeChapterId).toBe(useBookStore.getState().book.chapters[1].id)
    expect(screen.queryByDisplayValue('第二章')).toBeNull()
  })
})
