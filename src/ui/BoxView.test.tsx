import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { BoxView, UniversalBoxModal } from './BoxView'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
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

async function tick() {
  await new Promise((r) => setTimeout(r, 0))
}

function multiParaCard(cardId: string, texts: string[]) {
  return {
    type: 'card',
    attrs: { cardId, color: null, note: '' },
    content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
  }
}

// 点开卡片 = 打开编辑大窗（仿 Google Keep）：点卡片正文可以，点拖拽把手/插入按钮
// 不行——那两个各自有自己的行为，绝不能被"点开"抢走。
describe('BoxView — 点卡片打开编辑大窗（不劫持把手/插入按钮）', () => {
  it('点卡片正文（非把手/非插入按钮区域）打开编辑大窗，显示完整多段内容', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, multiParaCard('c1', ['第一段', '第二段', '第三段']))
    render(<BoxView boxId={box.id} />)

    expect(document.querySelector('.modal-backdrop--card-edit')).toBeNull()
    fireEvent.click(document.querySelector('.tcard-text')!)
    await tick()

    expect(document.querySelector('.modal-backdrop--card-edit')).toBeTruthy()
    expect(screen.getByText('第二段')).toBeTruthy()
    expect(screen.getByText('第三段')).toBeTruthy()
  })

  it('点拖拽把手不打开编辑大窗', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, multiParaCard('c1', ['文字']))
    render(<BoxView boxId={box.id} />)

    fireEvent.click(document.querySelector('[data-tcard-drag-handle]')!)
    await tick()
    expect(document.querySelector('.modal-backdrop--card-edit')).toBeNull()
  })

  it('点"插入正文"按钮不打开编辑大窗，且仍然正常触发 carry', async () => {
    const book = useBookStore.getState().addBook('A')
    useBookStore.getState().openBook(book.id)
    const box = useBookStore.getState().addBox('素材盒')!
    useBookStore.getState().parkCard(box.id, multiParaCard('c1', ['文字']))
    render(<BoxView boxId={box.id} />)

    fireEvent.click(document.querySelector('[data-box-action="insert"]')!)
    await tick()

    expect(document.querySelector('.modal-backdrop--card-edit')).toBeNull()
    expect(useBookStore.getState().carried).toEqual({ boxId: box.id, cardId: 'c1' })
  })

  it('关闭大窗后 store 里的编辑（比如别处调用 updateBoxCard）会在重新打开时看到最新内容', async () => {
    const box = useBookStore.getState().addBox('素材盒')
    useBookStore.getState().parkCard(box.id, multiParaCard('c1', ['旧内容']))
    render(<BoxView boxId={box.id} />)

    fireEvent.click(document.querySelector('.tcard-text')!)
    await tick()
    expect(within(document.querySelector('.card-edit-body')!).getByText('旧内容')).toBeTruthy()

    // 关闭
    fireEvent.click(screen.getByText('关闭'))
    await tick()
    expect(document.querySelector('.modal-backdrop--card-edit')).toBeNull()

    // 模拟内容被更新（真实场景是用户在大窗里打字触发 onUpdate→updateBoxCard）
    useBookStore.getState().updateBoxCard(box.id, 'c1', multiParaCard('c1', ['新内容']))

    // 重新打开，看到的是新内容而不是打开时那份旧快照
    fireEvent.click(document.querySelector('.tcard-text')!)
    await tick()
    expect(within(document.querySelector('.card-edit-body')!).getByText('新内容')).toBeTruthy()
    expect(within(document.querySelector('.card-edit-body')!).queryByText('旧内容')).toBeNull()
  })

  it('readOnly（书柜打开的通用盒子）：编辑大窗仍可打开、可编辑，只是不显示插入按钮', async () => {
    const box = useBookStore.getState().addUniversalBox('灵感')
    useBookStore.getState().parkCard(box.id, multiParaCard('u1', ['文字']))
    render(<BoxView boxId={box.id} readOnly />)

    fireEvent.click(document.querySelector('.tcard-text')!)
    await tick()

    expect(document.querySelector('.modal-backdrop--card-edit')).toBeTruthy()
    expect(document.querySelector('.card-edit-footer .card-edit-insert')).toBeNull()
    const pm = document.querySelector('.card-edit-body .ProseMirror') as HTMLElement
    expect(pm.getAttribute('contenteditable')).toBe('true')
  })

  it('编辑大窗在通用盒子悬浮大窗（UniversalBoxModal）之上：两个 modal-backdrop 都在，卡片大窗的 DOM 排在后面', async () => {
    const box = useBookStore.getState().addUniversalBox('灵感')
    useBookStore.getState().parkCard(box.id, multiParaCard('u1', ['文字']))
    render(<UniversalBoxModal boxId={box.id} onClose={() => {}} />)

    fireEvent.click(document.querySelector('.tcard-text')!)
    await tick()

    const backdrops = document.querySelectorAll('.modal-backdrop')
    expect(backdrops.length).toBe(2)
    expect(backdrops[1].classList.contains('modal-backdrop--card-edit')).toBe(true)
  })
})
