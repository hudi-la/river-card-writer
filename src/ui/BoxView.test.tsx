import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BoxView } from './BoxView'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

function cardJSON(cardId: string, text: string) {
  return { type: 'card', attrs: { cardId, threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('BoxView', () => {
  it('渲染盒子里两张卡的缩略图，各带文字预览和插入按钮', () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '第一张卡的文字'))
    useBookStore.getState().parkCard(box.id, cardJSON('c2', '第二张卡的文字'))

    render(<BoxView boxId={box.id} />)

    const tcards = document.querySelectorAll('.tcard')
    expect(tcards.length).toBe(2)
    expect(screen.getByText('第一张卡的文字')).toBeTruthy()
    expect(screen.getByText('第二张卡的文字')).toBeTruthy()

    const buttons = document.querySelectorAll('[data-box-action="insert"]')
    expect(buttons.length).toBe(2)
    expect(buttons[0].getAttribute('data-card-id')).toBe('c1')
    expect(buttons[1].getAttribute('data-card-id')).toBe('c2')
  })

  it('显示盒名和卡数', () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '文字'))
    render(<BoxView boxId={box.id} />)
    expect(screen.getByText(/素材盒/)).toBeTruthy()
    expect(screen.getByText(/1/)).toBeTruthy()
  })

  it('空盒子显示空状态提示', () => {
    const box = useBookStore.getState().addBox('空盒子')
    render(<BoxView boxId={box.id} />)
    expect(screen.getByText('这个盒子还是空的')).toBeTruthy()
    expect(document.querySelectorAll('.tcard').length).toBe(0)
  })

  it('卡 JSON 缺失/空段落不崩溃，显示空文字预览', () => {
    const box = useBookStore.getState().addBox('怪卡盒')
    useBookStore.getState().parkCard(box.id, { type: 'card', attrs: { cardId: 'weird' }, content: [{ type: 'paragraph' }] })
    expect(() => render(<BoxView boxId={box.id} />)).not.toThrow()
    expect(document.querySelectorAll('.tcard').length).toBe(1)
  })
})
