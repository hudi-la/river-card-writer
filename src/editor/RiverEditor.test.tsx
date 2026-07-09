import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiverEditor, findCardInDoc } from './RiverEditor'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

describe('RiverEditor', () => {
  it('把 book.doc 渲染成带 data-card-id 的 section，不再需要 chapterId prop', async () => {
    useBookStore.getState().updateDoc({
      type: 'doc', content: [
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] },
      ],
    })
    const { container } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')).toBeTruthy()
    expect(container.textContent).toContain('你好')
  })

  it('底部"＋ 加一张卡"按钮把新卡加进 book.doc（单文档，不再挂在某一章下）', async () => {
    useBookStore.getState().updateDoc({ type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    ] })
    const { getByText } = render(<RiverEditor />)
    await new Promise((r) => setTimeout(r, 0))
    await userEvent.click(getByText('＋ 加一张卡'))
    await new Promise((r) => setTimeout(r, 0))
    const cards = (useBookStore.getState().activeBook()!.doc as any).content
    expect(cards.length).toBe(2)
  })
})

describe('findCardInDoc（拖到盒子/拖拽重排共用的定位逻辑）', () => {
  it('按 cardId 在 doc 顶层子节点里找到对应卡的 pos 与节点', () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
          { type: 'card', attrs: { cardId: 'b' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
        ],
      },
    })
    const found = findCardInDoc(editor.state.doc, 'b')
    expect(found).not.toBeNull()
    expect(found!.node.attrs.cardId).toBe('b')
    expect(editor.state.doc.nodeAt(found!.pos)).toBe(found!.node)
    expect(findCardInDoc(editor.state.doc, 'nope')).toBeNull()
    editor.destroy()
  })
})
