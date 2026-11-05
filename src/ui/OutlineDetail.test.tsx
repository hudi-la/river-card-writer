import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutlineDetail } from './OutlineDetail'
import { useBookStore } from '../state/bookStore'
import { autoCardColor } from '../editor/schema'

const setHeadingNote = vi.fn()
const setCardNote = vi.fn()
const addChapter = vi.fn()
const moveCardTo = vi.fn()
const moveSection = vi.fn()
const toggleCollapsed = vi.fn()
vi.mock('../state/editorBridge', () => ({
  useEditorBridge: (selector: (s: any) => any) =>
    selector({
      editor: {},
      setEditor: vi.fn(),
      setHeadingNote,
      setCardNote,
      addChapter,
      moveCardTo,
      moveSection,
      toggleCollapsed,
    }),
}))

function docWithChapterAndBlocks() {
  return {
    type: 'doc',
    content: [
      {
        type: 'card',
        attrs: { cardId: 'c0' },
        content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第一章' }] }],
      },
      { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文一' }] }] },
      { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文二' }] }] },
    ],
  }
}

function docWithNote() {
  return {
    type: 'doc',
    content: [
      {
        type: 'card',
        content: [
          { type: 'paragraph', attrs: { style: 'chapter', note: '讲主角出发' }, content: [{ type: 'text', text: '一' }] },
        ],
      },
      { type: 'card', content: [{ type: 'paragraph', attrs: { style: 'h1' }, content: [{ type: 'text', text: '第一节' }] }] },
    ],
  }
}

beforeEach(() => {
  localStorage.clear()
  setHeadingNote.mockClear()
  setCardNote.mockClear()
  addChapter.mockClear()
  moveCardTo.mockClear()
  moveSection.mockClear()
  toggleCollapsed.mockClear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

describe('OutlineDetail', () => {
  it('空文档时显示提示', () => {
    render(<OutlineDetail />)
    expect(screen.getByText('还没有章节标题')).toBeTruthy()
  })

  it('说明暂停编辑，仍显示标题和正文行', () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    render(<OutlineDetail />)
    expect(screen.getByText('第一章')).toBeTruthy()
    expect(screen.getByText('正文一')).toBeTruthy()
    expect(screen.getByText('正文二')).toBeTruthy()
    expect(screen.queryByPlaceholderText('写点说明…')).toBeNull()
  })

  it('已有说明只读显示且不写回', () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<OutlineDetail />)
    expect(screen.getByText('讲主角出发')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(setHeadingNote).not.toHaveBeenCalled()
    expect(setCardNote).not.toHaveBeenCalled()
  })

  it('标题行（有后代）的折叠三角点击调用 editorBridge.toggleCollapsed(cardIndex)', async () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<OutlineDetail />)
    const chapterRow = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const triangle = chapterRow.querySelector('button.outline-collapse-triangle') as HTMLElement
    expect(triangle).toBeTruthy()
    await userEvent.click(triangle)
    expect(toggleCollapsed).toHaveBeenCalledWith(0)
  })

  it('折叠的标题行带折叠记号 class（跟简略树同一份视觉规则）', () => {
    const doc = docWithChapterAndBlocks()
    ;(doc.content[0].content[0] as any).attrs.collapsed = true
    useBookStore.getState().updateDoc(doc)
    const { container } = render(<OutlineDetail />)
    const chap1Card = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    expect(chap1Card.className).toContain('outline-collapsed')
  })

  it('每行的 outline-card 带 data-row-color，跟简略树同一份底色', () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<OutlineDetail />)
    const chap1Card = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    expect(chap1Card.getAttribute('data-row-color')).toBe(autoCardColor('c0'))
  })

  // Phase 15 回归修复：详细大纲跟侧栏简略树共用同一个 useOutlineRowDrag hook，
  // 拖拽同样只认专用把手当起点——每行（标题、块）都要渲染出这个把手。
  it('每一行（标题行、块行）都渲染一个专用拖拽把手 [data-outline-drag-handle]', () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<OutlineDetail />)
    const rows = container.querySelectorAll('[data-outline-row-index]')
    expect(rows.length).toBe(3)
    rows.forEach((row) => {
      expect(row.querySelector('[data-outline-drag-handle]')).toBeTruthy()
    })
  })
})
