import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
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
})
