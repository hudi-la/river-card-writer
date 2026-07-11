import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeftNav, outlineFromDoc } from './LeftNav'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { usePrefsStore } from '../state/prefsStore'

// mock 掉 editorBridge：LeftNav 编辑 note 时只应该经它调 setHeadingNote/setCardNote，
// 不直接碰 doc——mock 让我们断言调用参数，而不必真起一个 TipTap editor。
const setHeadingNote = vi.fn()
const setCardNote = vi.fn()
const addChapter = vi.fn()
vi.mock('../state/editorBridge', () => ({
  useEditorBridge: (selector: (s: any) => any) =>
    selector({ editor: {}, setEditor: vi.fn(), setHeadingNote, setCardNote, addChapter }),
}))

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
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
  usePrefsStore.getState().__resetForTest()
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
  it('目录区显示 doc 里的章/节标题文本（Phase 12：大纲变成树，正文块也以预览行的形式列在标题下）', () => {
    useBookStore.getState().updateDoc(docWithHeadings())
    render(<LeftNav />)
    expect(screen.getByText('一')).toBeTruthy()
    expect(screen.getByText('第一节')).toBeTruthy()
    expect(screen.getByText('二')).toBeTruthy()
    expect(screen.getByText('正文段落，不算标题')).toBeTruthy()
  })

  it('空文档时目录区显示提示，而不是空白', () => {
    render(<LeftNav />)
    expect(screen.getByText('还没有章节标题')).toBeTruthy()
  })

  it('空文档时目录区显示可点击的＋新章节，点击后调 editorBridge.addChapter', async () => {
    render(<LeftNav />)
    const btn = screen.getByText('＋ 新章节')
    await userEvent.click(btn)
    expect(addChapter).toHaveBeenCalledTimes(1)
  })

  it('已有章节时，＋新章节出现在目录列表底部', async () => {
    useBookStore.getState().updateDoc(docWithHeadings())
    render(<LeftNav />)
    expect(screen.getByText('一')).toBeTruthy()
    const btn = screen.getByText('＋ 新章节')
    expect(btn).toBeTruthy()
    await userEvent.click(btn)
    expect(addChapter).toHaveBeenCalledTimes(1)
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

  it('盒子组渲染出通用盒子项，点击后 openBox(UNIVERSAL_BOX_ID)', async () => {
    render(<LeftNav />)
    const row = screen.getByText('通用盒子')
    expect(row.closest('[data-box-id]')?.getAttribute('data-box-id')).toBe(UNIVERSAL_BOX_ID)
    await userEvent.click(row)
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(UNIVERSAL_BOX_ID)
  })

  it('打开通用盒子后，该项被记为 active', async () => {
    render(<LeftNav />)
    await userEvent.click(screen.getByText('通用盒子'))
    const row = screen.getByText('通用盒子').closest('[data-box-id]')
    expect(row?.className).toContain('on')
  })
})

function cardJSON(cardId: string, text: string) {
  return { type: 'card', attrs: { cardId }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('LeftNav 盒子内容展示', () => {
  it('盒子下默认展开，列出各卡片的一行文字预览', () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '第一张卡的内容'))
    useBookStore.getState().parkCard(box.id, cardJSON('c2', '第二张卡的内容'))
    render(<LeftNav />)
    expect(screen.getByText('第一张卡的内容')).toBeTruthy()
    expect(screen.getByText('第二张卡的内容')).toBeTruthy()
  })

  it('空卡显示淡色占位「（空卡）」', () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, { type: 'card', attrs: { cardId: 'empty' }, content: [{ type: 'paragraph', content: [] }] })
    render(<LeftNav />)
    expect(screen.getByText('（空卡）')).toBeTruthy()
  })

  it('长文本预览截断到约 30 字并带省略号', () => {
    const box = useBookStore.getState().addBox('素材盒')
    const longText = '这是一段很长很长很长很长很长很长很长很长很长很长很长很长很长很长的卡片正文内容'
    useBookStore.getState().parkCard(box.id, cardJSON('c1', longText))
    render(<LeftNav />)
    const preview = longText.slice(0, 30) + '…'
    expect(screen.getByText(preview)).toBeTruthy()
    expect(screen.queryByText(longText)).toBeNull()
  })

  it('点击折叠箭头后卡片预览消失，再点一次恢复展开', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '第一张卡的内容'))
    render(<LeftNav />)
    expect(screen.getByText('第一张卡的内容')).toBeTruthy()
    const row = screen.getByText('素材盒').closest('[data-box-id]') as HTMLElement
    await userEvent.click(within(row).getByLabelText('折叠'))
    expect(screen.queryByText('第一张卡的内容')).toBeNull()
    await userEvent.click(within(row).getByLabelText('展开'))
    expect(screen.getByText('第一张卡的内容')).toBeTruthy()
  })

  it('折叠/展开不影响点击盒名打开该盒子（viewKind/activeBoxId 照常更新）', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '第一张卡的内容'))
    render(<LeftNav />)
    const row = screen.getByText('素材盒').closest('[data-box-id]') as HTMLElement
    await userEvent.click(within(row).getByLabelText('折叠'))
    await userEvent.click(screen.getByText('素材盒'))
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(box.id)
  })

  it('点某卡片的 ⤵ 调用 store.carry(boxId, cardId)', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '第一张卡的内容'))
    const carrySpy = vi.spyOn(useBookStore.getState(), 'carry')
    render(<LeftNav />)
    await userEvent.click(screen.getByTitle('插入正文'))
    expect(carrySpy).toHaveBeenCalledWith(box.id, 'c1')
    carrySpy.mockRestore()
  })

  it('通用盒子的卡片也在其下列出，点 ⤵ 调用 carry(UNIVERSAL_BOX_ID, cardId)', async () => {
    useBookStore.getState().parkCard(UNIVERSAL_BOX_ID, cardJSON('u1', '通用盒子里的卡'))
    const carrySpy = vi.spyOn(useBookStore.getState(), 'carry')
    render(<LeftNav />)
    expect(screen.getByText('通用盒子里的卡')).toBeTruthy()
    await userEvent.click(screen.getByTitle('插入正文'))
    expect(carrySpy).toHaveBeenCalledWith(UNIVERSAL_BOX_ID, 'u1')
    carrySpy.mockRestore()
  })

  it('空盒子（无卡片）不渲染卡片列表，但箭头仍可点击', async () => {
    const box = useBookStore.getState().addBox('空盒子')
    render(<LeftNav />)
    expect(document.querySelector('.box-card-list')).toBeNull()
    const row = screen.getByText('空盒子').closest('[data-box-id]') as HTMLElement
    expect(row.getAttribute('data-box-id')).toBe(box.id)
    await userEvent.click(within(row).getByLabelText('折叠'))
    // 折叠后仍无卡片列表，不报错
    expect(document.querySelector('.box-card-list')).toBeNull()
  })
})

describe('LeftNav 简略/详细两视图', () => {
  it('默认简略视图：不铺出 note 文本框', () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    expect(screen.queryByDisplayValue('讲主角出发')).toBeNull()
  })

  it('切到详细视图后，每条 outline 项下面铺出显示该条 note 的文本框', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByText('详细'))
    expect(screen.getByDisplayValue('讲主角出发')).toBeTruthy()
    // 没 note 的条目也有一个（空的）文本框，占位一致
    const textareas = screen.getAllByPlaceholderText('写点说明…')
    expect(textareas.length).toBeGreaterThan(0)
  })

  it('详细视图切回简略后，note 文本框不再渲染', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByText('详细'))
    expect(screen.getByDisplayValue('讲主角出发')).toBeTruthy()
    await userEvent.click(screen.getByText('简略'))
    expect(screen.queryByDisplayValue('讲主角出发')).toBeNull()
  })

  it('详细视图里编辑某条 note，失焦后调 editorBridge.setHeadingNote(index, value)', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByText('详细'))
    const textarea = screen.getByDisplayValue('讲主角出发')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, '改过的说明')
    await userEvent.tab()
    expect(setHeadingNote).toHaveBeenCalledWith(0, '改过的说明')
  })

  it('视图选择持久化到 prefsStore.prefs.outlineView', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByText('详细'))
    expect(usePrefsStore.getState().prefs.outlineView).toBe('detail')
  })
})

// Phase 12 Task 2：大纲从"只列标题"换成"树"——标题行下面挂着它管辖范围内的
// 正文块行（带预览/note）。
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

describe('LeftNav 大纲树：标题行 + 块行（Phase 12 Task 2）', () => {
  it('渲染出标题行 + 两个块行，块行显示预览文字', () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    render(<LeftNav />)
    expect(screen.getByText('第一章')).toBeTruthy()
    expect(screen.getByText('正文一')).toBeTruthy()
    expect(screen.getByText('正文二')).toBeTruthy()
  })

  it('块写了 note 后该行显示 note，而不是预览', () => {
    const doc = docWithChapterAndBlocks()
    ;(doc.content[1] as any).attrs = { cardId: 'c1', note: '这块讲主角觉醒' }
    useBookStore.getState().updateDoc(doc)
    render(<LeftNav />)
    expect(screen.getByText('这块讲主角觉醒')).toBeTruthy()
    expect(screen.queryByText('正文一')).toBeNull()
  })

  it('空块（无文字无 note）显示淡色占位「（空块）」', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0' },
          content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第一章' }] }],
        },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [] }] },
      ],
    }
    useBookStore.getState().updateDoc(doc)
    render(<LeftNav />)
    expect(screen.getByText('（空块）')).toBeTruthy()
  })

  it('详细视图里每个块行也铺出 note 文本框，编辑后调 editorBridge.setCardNote(cardIndex, value)', async () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    render(<LeftNav />)
    await userEvent.click(screen.getByText('详细'))
    const textareas = screen.getAllByPlaceholderText('写点说明…')
    // rows 顺序：[章(cardIndex 0), 正文一(cardIndex 1), 正文二(cardIndex 2)]，
    // 文本框顺序跟 rows 一致——第二个文本框对应 cardIndex 1 的块。
    expect(textareas.length).toBe(3)
    await userEvent.type(textareas[1], '块说明')
    await userEvent.tab()
    expect(setCardNote).toHaveBeenCalledWith(1, '块说明')
  })

  it('详细视图里标题行的 note 仍走 editorBridge.setHeadingNote(headingIndex, value)', async () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    render(<LeftNav />)
    await userEvent.click(screen.getByText('详细'))
    const textareas = screen.getAllByPlaceholderText('写点说明…')
    await userEvent.type(textareas[0], '章节说明')
    await userEvent.tab()
    expect(setHeadingNote).toHaveBeenCalledWith(0, '章节说明')
    expect(setCardNote).not.toHaveBeenCalled()
  })

  it('点块行滚动到该块（正文里第 cardIndex 个 section.card scrollIntoView）', async () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    render(<LeftNav />)
    const cards = [0, 1, 2].map(() => {
      const el = document.createElement('section')
      el.className = 'card'
      document.body.appendChild(el)
      el.scrollIntoView = vi.fn()
      return el
    })
    const river = document.createElement('div')
    river.className = 'river'
    cards.forEach((c) => river.appendChild(c))
    document.body.appendChild(river)
    await userEvent.click(screen.getByText('正文二'))
    await new Promise((r) => setTimeout(r, 0))
    expect(cards[2].scrollIntoView).toHaveBeenCalled()
    river.remove()
    cards.forEach((c) => c.remove())
  })
})
