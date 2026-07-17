import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeftNav, outlineFromDoc } from './LeftNav'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { usePrefsStore } from '../state/prefsStore'
import { autoCardColor } from '../editor/schema'

// mock 掉 editorBridge：LeftNav 编辑 note 时只应该经它调 setHeadingNote/setCardNote，
// 不直接碰 doc——mock 让我们断言调用参数，而不必真起一个 TipTap editor。
const setHeadingNote = vi.fn()
const setCardNote = vi.fn()
const addChapter = vi.fn()
const moveCardTo = vi.fn()
const moveSection = vi.fn()
const toggleCollapsed = vi.fn()
// 大纲块行拖到盒子（park）——默认返回 true（模拟 park 成功），个别测试按需覆写
// mockReturnValueOnce 来断言"park 失败时不做额外动作"之类的分支。
const parkOutlineCardToBox = vi.fn(() => true)
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
      parkOutlineCardToBox,
    }),
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
  moveCardTo.mockClear()
  moveSection.mockClear()
  toggleCollapsed.mockClear()
  parkOutlineCardToBox.mockClear()
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
    const btn = screen.getByText('新章节')
    await userEvent.click(btn)
    expect(addChapter).toHaveBeenCalledTimes(1)
  })

  it('已有章节时，＋新章节出现在目录列表底部', async () => {
    useBookStore.getState().updateDoc(docWithHeadings())
    render(<LeftNav />)
    expect(screen.getByText('一')).toBeTruthy()
    const btn = screen.getByText('新章节')
    expect(btn).toBeTruthy()
    await userEvent.click(btn)
    expect(addChapter).toHaveBeenCalledTimes(1)
  })

  it('点"＋ 新盒子"后 store.boxes +1，并进入该盒子', async () => {
    render(<LeftNav />)
    expect(useBookStore.getState().activeBook()!.boxes.length).toBe(0)
    await userEvent.click(screen.getByText('新盒子'))
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

  it('盒子组渲染出通用盒子项，点击后打开该盒子的悬浮大窗（Modal），而不是 openBox/viewKind', async () => {
    render(<LeftNav />)
    const row = screen.getByText('通用盒子').closest('[data-box-id]') as HTMLElement
    expect(row.getAttribute('data-box-id')).toBe(UNIVERSAL_BOX_ID)
    await userEvent.click(within(row).getByText('通用盒子'))
    // 点击不改变 viewKind/activeBoxId——那条路是"本书盒子"专用的
    expect(useBookStore.getState().viewKind).toBe('doc')
    expect(useBookStore.getState().activeBoxId).toBeNull()
    // 通用盒子的"开"带一个短延迟（跟双击改名去抖，见 LeftNav.tsx 的
    // OVERLAY_CLICK_DISAMBIGUATE_MS 注释），单击最终仍会打开，只是不再是
    // 严格同步的——用 waitFor 等它落定。
    await waitFor(() => {
      const dialog = screen.getByRole('dialog')
      expect(dialog.getAttribute('aria-label')).toBe('通用盒子')
    })
  })

  it('打开通用盒子后，该项被记为 active；关闭大窗后恢复', async () => {
    render(<LeftNav />)
    const row = screen.getByText('通用盒子').closest('[data-box-id]') as HTMLElement
    await userEvent.click(within(row).getByText('通用盒子'))
    await waitFor(() => expect(row.className).toContain('on'))
    await userEvent.click(screen.getByLabelText('关闭'))
    expect(row.className).not.toContain('on')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('多个通用盒子：书内侧栏列出全部，各自点击打开各自的大窗', async () => {
    const inspiration = useBookStore.getState().addUniversalBox('灵感')
    render(<LeftNav />)
    expect(screen.getByText('通用盒子')).toBeTruthy()
    expect(screen.getByText('灵感')).toBeTruthy()

    const inspirationRow = screen.getByText('灵感').closest('[data-box-id]') as HTMLElement
    expect(inspirationRow.getAttribute('data-box-id')).toBe(inspiration.id)
    await userEvent.click(within(inspirationRow).getByText('灵感'))
    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('灵感'))
  })
})

describe('LeftNav 盒子改名', () => {
  it('双击本书盒子名进入编辑态，输入新名字回车后调用 renameBox(boxId, name)', async () => {
    const box = useBookStore.getState().addBox('旧盒名')!
    const renameSpy = vi.spyOn(useBookStore.getState(), 'renameBox')
    render(<LeftNav />)
    const nameEl = screen.getByText('旧盒名')
    await userEvent.dblClick(nameEl)
    const input = screen.getByDisplayValue('旧盒名') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '新盒名{Enter}')
    expect(renameSpy).toHaveBeenCalledWith(box.id, '新盒名')
    renameSpy.mockRestore()
  })

  it('双击通用盒子名进入编辑态，输入新名字回车后调用 renameUniversalBox(id, name)', async () => {
    const renameSpy = vi.spyOn(useBookStore.getState(), 'renameUniversalBox')
    render(<LeftNav />)
    const nameEl = screen.getByText('通用盒子')
    await userEvent.dblClick(nameEl)
    const input = screen.getByDisplayValue('通用盒子') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '灵感{Enter}')
    expect(renameSpy).toHaveBeenCalledWith(UNIVERSAL_BOX_ID, '灵感')
    renameSpy.mockRestore()
  })

  it('单击（非双击）盒子名仍然打开该盒子，且不进入编辑态', async () => {
    const box = useBookStore.getState().addBox('素材盒')!
    render(<LeftNav />)
    const nameEl = screen.getByText('素材盒')
    await userEvent.click(nameEl)
    expect(useBookStore.getState().viewKind).toBe('box')
    expect(useBookStore.getState().activeBoxId).toBe(box.id)
    expect(screen.queryByDisplayValue('素材盒')).toBeNull()
  })

  it('改名为空白（trim 后为空）不调用 renameBox，直接退出编辑态', async () => {
    const box = useBookStore.getState().addBox('素材盒')!
    render(<LeftNav />)
    const nameEl = screen.getByText('素材盒')
    await userEvent.dblClick(nameEl)
    const input = screen.getByDisplayValue('素材盒') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '   {Enter}')
    // 盒名在 store 里没变——空白输入被忽略，没有调用改名
    expect(useBookStore.getState().activeBook()!.boxes.find((b) => b.id === box.id)?.name).toBe('素材盒')
    expect(screen.getByText('素材盒')).toBeTruthy()
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

// Phase 14 Task 2：详细视图搬进悬浮大窗——侧栏不再有简略/详细切换，只有一个
// "详细"按钮开窗；窗内是 OutlineDetail（每行 note 文本框），窗外侧栏本身永远
// 是简略树，不铺 note 文本框。
describe('LeftNav 侧栏只留简略树 + 详细按钮开悬浮大窗（Phase 14 Task 2）', () => {
  it('不再渲染简略/详细切换按钮', () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    expect(screen.queryByText('简略')).toBeNull()
  })

  it('侧栏本身（未开窗）不铺出 note 文本框，即使条目有 note', () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    expect(screen.queryByDisplayValue('讲主角出发')).toBeNull()
    expect(screen.queryByPlaceholderText('写点说明…')).toBeNull()
  })

  it('点"详细"按钮打开悬浮大窗，里面是详细大纲（每条 note 文本框）', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    expect(screen.queryByText('详细大纲')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '排列' }))
    expect(screen.getByText('详细大纲')).toBeTruthy()
    expect(screen.getByDisplayValue('讲主角出发')).toBeTruthy()
  })

  it('大窗内编辑某条 note，失焦后调 editorBridge.setHeadingNote(index, value)', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByRole('button', { name: '排列' }))
    const textarea = screen.getByDisplayValue('讲主角出发')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, '改过的说明')
    await userEvent.tab()
    expect(setHeadingNote).toHaveBeenCalledWith(0, '改过的说明')
  })

  it('按 Esc 关闭大窗', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByRole('button', { name: '排列' }))
    expect(screen.getByText('详细大纲')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('详细大纲')).toBeNull()
  })

  it('点遮罩关闭大窗', async () => {
    useBookStore.getState().updateDoc(docWithNote())
    render(<LeftNav />)
    await userEvent.click(screen.getByRole('button', { name: '排列' }))
    const backdrop = document.querySelector('.modal-backdrop') as HTMLElement
    await userEvent.click(backdrop)
    expect(screen.queryByText('详细大纲')).toBeNull()
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

// Phase 12 Task 3：目录内拖动重排。doc 结构跟 moveSection.test.ts 的六卡用例
// 对应：[章1(0), 卡A(1), 节1.1(2), 卡B(3), 章2(4), 卡C(5)]。rows 数组下标本来
// 就等于 cardIndex（outlineTreeFromDoc 一张卡一行），拖拽逻辑直接复用这个下标。
function docTwoChaptersWithSection() {
  return {
    type: 'doc',
    content: [
      { type: 'card', attrs: { cardId: 'chap1' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第一章' }] }] },
      { type: 'card', attrs: { cardId: 'cardA' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文A' }] }] },
      { type: 'card', attrs: { cardId: 'h11' }, content: [{ type: 'paragraph', attrs: { style: 'h1' }, content: [{ type: 'text', text: '第一节' }] }] },
      { type: 'card', attrs: { cardId: 'cardB' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文B' }] }] },
      { type: 'card', attrs: { cardId: 'chap2' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第二章' }] }] },
      { type: 'card', attrs: { cardId: 'cardC' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文C' }] }] },
    ],
  }
}

// jsdom 没有真实布局，getBoundingClientRect 默认全 0——按行下标铺出等高
// （30px）的假矩形，落点计算（中点比较）才有意义。
function stubOutlineRowRects(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-outline-row-index]').forEach((el) => {
    const i = Number(el.dataset.outlineRowIndex)
    el.getBoundingClientRect = () =>
      ({ top: i * 30, bottom: i * 30 + 30, height: 30, left: 0, right: 150, width: 150, x: 0, y: i * 30, toJSON() {} }) as DOMRect
  })
}

// Phase 15 回归修复：拖拽现在只认行上的专用把手（[data-outline-drag-handle]）
// 当起点，不再是整行——dragRow 因此从行元素里先找出把手，pointerdown 派发在
// 把手上；pointermove/pointerup 仍然走 window（跟真实拖拽一致，見
// useOutlineRowDrag 的事件绑定）。
function dragHandleOf(row: HTMLElement): HTMLElement {
  const handle = row.querySelector('[data-outline-drag-handle]') as HTMLElement
  if (!handle) throw new Error('outline row 缺少拖拽把手 [data-outline-drag-handle]')
  return handle
}

function dragRow(row: HTMLElement, fromY: number, toY: number) {
  const handle = dragHandleOf(row)
  handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: fromY, pointerId: 1, button: 0, bubbles: true }))
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: toY, pointerId: 1, bubbles: true }))
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: toY, pointerId: 1, bubbles: true }))
}

// 拖一行的把手到某个盒子行上——跟 RiverEditor.test.tsx 里 park 到盒子的测试同一个
// 手法：jsdom 没有真实布局/elementFromPoint，直接把 document.elementFromPoint 打桩
// 成固定返回目标盒子元素，等价于"真实鼠标最后悬停在这个盒子行上"。落点 y 坐标本身
// 在这里不重要（box 命中判定发生在 outlineDropAt 算重排落点之前，见 onPointerMove），
// 只要跨过拖拽阈值即可。
function dragRowOntoBox(row: HTMLElement, boxEl: HTMLElement) {
  const originalElementFromPoint = document.elementFromPoint?.bind(document)
  document.elementFromPoint = () => boxEl
  try {
    const handle = dragHandleOf(row)
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 45, pointerId: 1, button: 0, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 200, pointerId: 1, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 200, pointerId: 1, bubbles: true }))
  } finally {
    if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
    else delete (document as any).elementFromPoint
  }
}

// 回归测试（Phase 15）：拖拽改成只认专用把手当起点之后，行本身的 pointerdown
// 不再 setPointerCapture，原生 click 不会被重定向——点击行（不经过把手）就应该
// 直接靠 onClick 触发 click-to-scroll，不需要再靠"未越阈值的 pointerup"这个
// 迂回路径。这里直接派发一次 click，模拟真实浏览器的鼠标单击（down+up 没有
// 移动时浏览器会自动补一个 click，jsdom 的 fireEvent.click 等价于这一步）。
describe('LeftNav 目录点击定位——拖拽收进把手后，行的点击恢复走原生 click（Phase 15 回归修复）', () => {
  it('块行：点击行（非把手）滚动到对应正文块', async () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
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

    const blockRow = container.querySelector('[data-outline-row-index="2"] .outline-row') as HTMLElement
    fireEvent.click(blockRow)
    await new Promise((r) => setTimeout(r, 0))

    expect(cards[2].scrollIntoView).toHaveBeenCalled()
    river.remove()
    cards.forEach((c) => c.remove())
  })

  it('标题行：点击行（非把手）滚动到对应标题', async () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const heading = document.createElement('p')
    heading.setAttribute('data-style', 'chapter')
    heading.scrollIntoView = vi.fn()
    const river = document.createElement('div')
    river.className = 'river'
    river.appendChild(heading)
    document.body.appendChild(river)

    const headingRow = container.querySelector('[data-outline-row-index="0"] .outline-row') as HTMLElement
    fireEvent.click(headingRow)
    await new Promise((r) => setTimeout(r, 0))

    expect(heading.scrollIntoView).toHaveBeenCalled()
    river.remove()
  })

  it('从把手真的越过阈值的拖拽不触发滚动（只触发 moveCardTo/moveSection）', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cards = [0].map(() => {
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

    const cardARow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    dragRow(cardARow, 45, 500)
    expect(moveCardTo).toHaveBeenCalledWith(1, 6)
    expect(cards[0].scrollIntoView).not.toHaveBeenCalled()
    river.remove()
    cards.forEach((c) => c.remove())
  })

  it('pointerdown 落在行文字上（不是把手）不会开始拖拽——移动再多也不触发 moveCardTo', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cardARow = container.querySelector('[data-outline-row-index="1"] .outline-row-text') as HTMLElement
    cardARow.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 45, pointerId: 1, button: 0, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 500, pointerId: 1, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 500, pointerId: 1, bubbles: true }))
    expect(moveCardTo).not.toHaveBeenCalled()
    expect(moveSection).not.toHaveBeenCalled()
  })
})

describe('LeftNav 目录内拖动重排（Phase 12 Task 3）', () => {
  it('拖动块行到目录末尾——调 editorBridge.moveCardTo(cardIndex, targetIndex)', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cardARow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    dragRow(cardARow, 45, 500) // 45 = 卡A 自己那行中点附近，500 远在所有行下方
    expect(moveCardTo).toHaveBeenCalledTimes(1)
    expect(moveCardTo).toHaveBeenCalledWith(1, 6)
    expect(moveSection).not.toHaveBeenCalled()
  })

  it('拖动节行（h1）到目录最前——调 editorBridge.moveSection(headingCardIndex, targetIndex)，只带走它自己管辖的块', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const h11Row = container.querySelector('[data-outline-row-index="2"]') as HTMLElement
    dragRow(h11Row, 75, -50) // -50 落在第 0 行中点之上
    expect(moveSection).toHaveBeenCalledTimes(1)
    expect(moveSection).toHaveBeenCalledWith(2, 0)
    expect(moveCardTo).not.toHaveBeenCalled()
  })

  it('拖动章行（chapter）到目录末尾——章带着它整段（自己+正文块+子节）一起移动', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    dragRow(chap1Row, 15, 500)
    expect(moveSection).toHaveBeenCalledTimes(1)
    expect(moveSection).toHaveBeenCalledWith(0, 6)
    expect(moveCardTo).not.toHaveBeenCalled()
  })

  it('位移没越过阈值——当成一次点击，不触发任何拖拽命令，click-to-scroll 照常', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cardARow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    dragRow(cardARow, 45, 46) // 位移 1px，远小于阈值
    expect(moveCardTo).not.toHaveBeenCalled()
    expect(moveSection).not.toHaveBeenCalled()
  })

  // Phase 15：每一行（标题行、块行）都必须渲染出专用的拖拽把手——这是拖拽唯一
  // 认可的起点，没有它整套 dragRow 测试都无从驱动（见 dragHandleOf 的报错）。
  it('每一行（标题行、块行）都渲染一个专用拖拽把手 [data-outline-drag-handle]', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const { container } = render(<LeftNav />)
    const rows = container.querySelectorAll('[data-outline-row-index]')
    expect(rows.length).toBe(6) // 章1,卡A,节1.1,卡B,章2,卡C
    rows.forEach((row) => {
      expect(row.querySelector('[data-outline-drag-handle]')).toBeTruthy()
    })
  })
})

describe('LeftNav 大纲块行拖到盒子（镜像正文卡片拖到盒子的 park 交互）', () => {
  it('拖动块行的把手到盒子行上——调 editorBridge.parkOutlineCardToBox(cardIndex, boxId)，不触发重排/点击定位', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const box = useBookStore.getState().addBox('素材盒')!
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cardARow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    const boxRow = container.querySelector(`[data-box-id="${box.id}"]`) as HTMLElement
    expect(boxRow).toBeTruthy()

    dragRowOntoBox(cardARow, boxRow)

    expect(parkOutlineCardToBox).toHaveBeenCalledTimes(1)
    expect(parkOutlineCardToBox).toHaveBeenCalledWith(1, box.id)
    expect(moveCardTo).not.toHaveBeenCalled()
    expect(moveSection).not.toHaveBeenCalled()
  })

  it('松手落在盒子上时给盒子行加悬停高亮 class，松手（park）后清掉，不留残留', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const box = useBookStore.getState().addBox('素材盒')!
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cardARow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    const boxRow = container.querySelector(`[data-box-id="${box.id}"]`) as HTMLElement

    const originalElementFromPoint = document.elementFromPoint?.bind(document)
    document.elementFromPoint = () => boxRow
    try {
      const handle = dragHandleOf(cardARow)
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 5, clientY: 45, pointerId: 1, button: 0, bubbles: true }))
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 200, pointerId: 1, bubbles: true }))
      // 拖拽悬停在盒子上的这一刻，盒子行应该已经带上高亮 class。
      expect(boxRow.classList.contains('drop-target')).toBe(true)
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 5, clientY: 200, pointerId: 1, bubbles: true }))
    } finally {
      if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
      else delete (document as any).elementFromPoint
    }

    // 松手完成 park 之后，高亮必须被摘掉——不能留着一个"卡在悬停态"的盒子行。
    expect(boxRow.classList.contains('drop-target')).toBe(false)
  })

  it('拖到目录内两行之间（不悬停在任何盒子上）——照常走重排，不误触发 park', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    useBookStore.getState().addBox('素材盒')
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const cardARow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    dragRow(cardARow, 45, 500) // 沿用普通重排的 dragRow——没有 stub elementFromPoint，box 检测天然拿不到命中

    expect(parkOutlineCardToBox).not.toHaveBeenCalled()
    expect(moveCardTo).toHaveBeenCalledTimes(1)
    expect(moveCardTo).toHaveBeenCalledWith(1, 6)
  })

  it('拖动标题（章）行的把手到盒子行上——不 park（整段拖进盒子明确不支持），也不误触发重排', () => {
    useBookStore.getState().updateDoc(docTwoChaptersWithSection())
    const box = useBookStore.getState().addBox('素材盒')!
    const { container } = render(<LeftNav />)
    stubOutlineRowRects(container)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const boxRow = container.querySelector(`[data-box-id="${box.id}"]`) as HTMLElement

    dragRowOntoBox(chap1Row, boxRow)

    expect(parkOutlineCardToBox).not.toHaveBeenCalled()
    expect(boxRow.classList.contains('drop-target')).toBe(false)
    // 悬停在盒子上时被当成"不算命中盒子"，重排逻辑接手——落点计算会在 200
    // 这个纵坐标下走到目录末尾（跟纯重排测试同样的落点，见上面章行拖到末尾的用例）。
    expect(moveSection).toHaveBeenCalledTimes(1)
    expect(moveSection).toHaveBeenCalledWith(0, 6)
  })
})

// Phase 13 Task 2：目录标题行的折叠三角——收起时目录不渲染该标题管辖的后代行
// （块 + 子节），正文那边的隐藏由 Task 1 的装饰器另行处理，这里只测目录树。
// 结构跟 docTwoChaptersWithSection 类似但块数不同："章+两块+一节+一块"：
// [章1(0,collapsed?), 正文A(1), 正文B(2), 第一节(3), 正文C(4), 章2(5)]。
function docChapterWithBlocksAndSection(chap1Collapsed = false) {
  return {
    type: 'doc',
    content: [
      {
        type: 'card',
        attrs: { cardId: 'chap1' },
        content: [{ type: 'paragraph', attrs: { style: 'chapter', collapsed: chap1Collapsed }, content: [{ type: 'text', text: '第一章' }] }],
      },
      { type: 'card', attrs: { cardId: 'cardA' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文A' }] }] },
      { type: 'card', attrs: { cardId: 'cardB' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文B' }] }] },
      { type: 'card', attrs: { cardId: 'h11' }, content: [{ type: 'paragraph', attrs: { style: 'h1' }, content: [{ type: 'text', text: '第一节' }] }] },
      { type: 'card', attrs: { cardId: 'cardC' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文C' }] }] },
      {
        type: 'card',
        attrs: { cardId: 'chap2' },
        content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第二章' }] }],
      },
    ],
  }
}

describe('LeftNav 目录折叠三角（Phase 13 Task 2）', () => {
  it('有后代的标题行显示折叠三角（未折叠时是 ▾）', () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection())
    const { container } = render(<LeftNav />)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const triangle = within(chap1Row).getByLabelText('折叠')
    expect(triangle.getAttribute('data-collapsed')).toBe('false')
  })

  it('点标题行的三角调 editorBridge.toggleCollapsed(cardIndex)，且不触发行的点击滚动/拖拽', async () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection())
    const openDocSpy = vi.spyOn(useBookStore.getState(), 'openDoc')
    const { container } = render(<LeftNav />)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const triangle = within(chap1Row).getByLabelText('折叠')
    await userEvent.click(triangle)
    expect(toggleCollapsed).toHaveBeenCalledTimes(1)
    expect(toggleCollapsed).toHaveBeenCalledWith(0)
    // 点三角不应该冒泡触发整行的点击滚动（openDoc 是 handleRowClick 第一步）
    expect(openDocSpy).not.toHaveBeenCalled()
    expect(moveCardTo).not.toHaveBeenCalled()
    expect(moveSection).not.toHaveBeenCalled()
    openDocSpy.mockRestore()
  })

  it('标题 collapsed=true 时，目录不渲染其后代行（块+子节），标题本身仍在，后面同级章照常渲染', () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection(true))
    render(<LeftNav />)
    expect(screen.getByText('第一章')).toBeTruthy()
    expect(screen.queryByText('正文A')).toBeNull()
    expect(screen.queryByText('正文B')).toBeNull()
    expect(screen.queryByText('第一节')).toBeNull()
    expect(screen.queryByText('正文C')).toBeNull()
    expect(screen.getByText('第二章')).toBeTruthy()
  })

  it('标题 collapsed=true 时三角显示 ▸', () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection(true))
    const { container } = render(<LeftNav />)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const triangle = within(chap1Row).getByLabelText('展开')
    expect(triangle.getAttribute('data-collapsed')).toBe('true')
  })

  it('没有后代的标题行（如空章）不显示可点的折叠三角', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'chapOnly' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '孤章' }] }] },
      ],
    }
    useBookStore.getState().updateDoc(doc)
    const { container } = render(<LeftNav />)
    const row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    expect(within(row).queryByLabelText('折叠')).toBeNull()
    expect(within(row).queryByLabelText('展开')).toBeNull()
  })

  it('块行没有折叠三角', () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection())
    const { container } = render(<LeftNav />)
    const blockRow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    expect(within(blockRow).queryByLabelText('折叠')).toBeNull()
    expect(within(blockRow).queryByLabelText('展开')).toBeNull()
  })

})

// Phase 14 Task 1：目录小改——折叠记号 + 统色 + 预览按宽度截断加省略号。
describe('LeftNav 目录小改（Phase 14 Task 1）', () => {
  it('#1 折叠的标题行带折叠记号 class，展开的不带', () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection(true))
    const { container } = render(<LeftNav />)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    expect(chap1Row.querySelector('.outline-collapsed')).toBeTruthy()
  })

  it('#1 未折叠的标题行不带折叠记号 class', () => {
    useBookStore.getState().updateDoc(docChapterWithBlocksAndSection(false))
    const { container } = render(<LeftNav />)
    const chap1Row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    expect(chap1Row.querySelector('.outline-collapsed')).toBeNull()
  })

  it('#2 目录行底色读该卡片的手动 color', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0', color: '#ff0000' },
          content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第一章' }] }],
        },
      ],
    }
    useBookStore.getState().updateDoc(doc)
    const { container } = render(<LeftNav />)
    const row = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    expect(row.getAttribute('data-row-color')).toBe('#ff0000')
  })

  it('#2 没手动设色时目录行底色用 autoCardColor(cardId)', () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<LeftNav />)
    const headingRow = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const blockRow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    expect(headingRow.getAttribute('data-row-color')).toBe(autoCardColor('c0'))
    expect(blockRow.getAttribute('data-row-color')).toBe(autoCardColor('c1'))
  })

  it('#4 块行预览容器带单行省略 class，标题行不带', () => {
    useBookStore.getState().updateDoc(docWithChapterAndBlocks())
    const { container } = render(<LeftNav />)
    const headingRow = container.querySelector('[data-outline-row-index="0"]') as HTMLElement
    const blockRow = container.querySelector('[data-outline-row-index="1"]') as HTMLElement
    const headingSpan = headingRow.querySelector('.outline-row-text') as HTMLElement
    const blockSpan = blockRow.querySelector('.outline-row-text') as HTMLElement
    expect(blockSpan.className).toContain('outline-preview-ellipsis')
    expect(headingSpan.className).not.toContain('outline-preview-ellipsis')
  })

  it('#4 块行预览不再固定截断到14字——完整文字进 DOM，交给 CSS 按宽度截断', () => {
    const longText = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'
    const doc = {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '章' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }] },
      ],
    }
    useBookStore.getState().updateDoc(doc)
    render(<LeftNav />)
    expect(screen.getByText(longText)).toBeTruthy()
  })
})
