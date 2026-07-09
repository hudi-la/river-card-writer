import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Workspace } from './Workspace'
import { useBookStore } from '../state/bookStore'

beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })

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
    expect(useBookStore.getState().book.boxes.length).toBe(0)
    await userEvent.click(screen.getByText('＋ 新盒子'))
    const boxes = useBookStore.getState().book.boxes
    expect(boxes.length).toBe(1)
    expect(useBookStore.getState().viewKind).toBe('box')
  })
})
