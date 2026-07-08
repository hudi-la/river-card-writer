import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiverEditor } from './RiverEditor'
import { useBookStore } from '../state/bookStore'

beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })

describe('RiverEditor', () => {
  it('把该章 doc 渲染成带 data-card-id 的 section', async () => {
    const id = useBookStore.getState().activeChapterId
    useBookStore.getState().updateChapterDoc(id, {
      type: 'doc', content: [
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] },
      ],
    })
    const { container } = render(<RiverEditor chapterId={id} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')).toBeTruthy()
    expect(container.textContent).toContain('你好')
  })

  it('底部"＋ 加一张卡"按钮把新卡加进当前章', async () => {
    const id = useBookStore.getState().activeChapterId
    useBookStore.getState().updateChapterDoc(id, { type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    ] })
    const { getByText } = render(<RiverEditor chapterId={id} />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(getByText('＋ 加一张卡'))
    await new Promise((r) => setTimeout(r, 0))
    expect(useBookStore.getState().getActiveChapter().doc as any).toBeTruthy()
    const cards = (useBookStore.getState().getActiveChapter().doc as any).content
    expect(cards.length).toBe(2)
  })
})
