import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeftNav, outlineFromDoc } from './LeftNav'
import { useBookStore } from '../state/bookStore'

function docWithHeadings() {
  return {
    type: 'doc',
    content: [
      { type: 'card', content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '一' }] }] },
      { type: 'card', content: [{ type: 'paragraph', attrs: { style: 'h1' }, content: [{ type: 'text', text: '第一节' }] }] },
      { type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文段落，不算标题' }] }] },
      { type: 'card', content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '二' }] }] },
    ],
  }
}

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

describe('outlineFromDoc', () => {
  it('按顺序抽出 chapter(level 1)/h1(level 2) 段落，忽略 body 段落，index 为标题间的序号', () => {
    expect(outlineFromDoc(docWithHeadings())).toEqual([
      { level: 1, text: '一', index: 0, note: '' },
      { level: 2, text: '第一节', index: 1, note: '' },
      { level: 1, text: '二', index: 2, note: '' },
    ])
  })

  it('空文档（无标题段落）返回空数组', () => {
    expect(outlineFromDoc(useBookStore.getState().activeBook()!.doc)).toEqual([])
  })
})

describe('LeftNav', () => {
  it('目录区显示 doc 里的章/节标题文本', () => {
    useBookStore.getState().updateDoc(docWithHeadings())
    render(<LeftNav />)
    expect(screen.getByText('一')).toBeTruthy()
    expect(screen.getByText('第一节')).toBeTruthy()
    expect(screen.getByText('二')).toBeTruthy()
    expect(screen.queryByText('正文段落，不算标题')).toBeNull()
  })

  it('空文档时目录区显示提示，而不是空白', () => {
    render(<LeftNav />)
    expect(screen.getByText('还没有章节标题')).toBeTruthy()
  })

  it('点"＋ 新盒子"后 store.boxes +1，并进入该盒子', async () => {
    render(<LeftNav />)
    expect(useBookStore.getState().activeBook()!.boxes.length).toBe(0)
    await userEvent.click(screen.getByText('＋ 新盒子'))
    const boxes = useBookStore.getState().activeBook()!.boxes
    expect(boxes.length).toBe(1)
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(boxes[0].id)
  })

  it('点某盒子后 viewKind 变为 box，且该盒子被记为 active（data-box-id 供拖放命中）', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    render(<LeftNav />)
    const row = screen.getByText('素材盒')
    expect(row.closest('[data-box-id]')?.getAttribute('data-box-id')).toBe(box.id)
    await userEvent.click(row)
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(box.id)
  })
})
