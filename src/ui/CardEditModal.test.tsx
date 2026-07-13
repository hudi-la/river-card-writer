import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardEditModal, flattenEditedCard } from './CardEditModal'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

function multiParaCard(cardId: string, texts: string[]) {
  return {
    type: 'card',
    attrs: { cardId, color: null, note: '' },
    content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
  }
}

async function tick() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('CardEditModal — flattenEditedCard（压平安全网，纯函数）', () => {
  it('正常情况（顶层仍是一张 card）：内容原样取出，attrs 仍沿用原卡', () => {
    const original = multiParaCard('c1', ['第一段', '第二段'])
    const doc = { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'c1', color: null, note: '' }, content: original.content }] }
    const flat = flattenEditedCard(doc, original)
    expect(flat.attrs.cardId).toBe('c1')
    expect(flat.content).toEqual(original.content)
  })

  it('意外拆成多张顶层 card 时，把所有段落按顺序压平进同一张卡，attrs 一律用原卡的（不用拆出来那张的）', () => {
    const original = { type: 'card', attrs: { cardId: 'c1', color: '#8bad86', note: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] }
    const doc = {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c1', color: '#8bad86', note: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
        { type: 'card', attrs: { cardId: null, color: null, note: '' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '意外拆出来的第二段' }] }] },
      ],
    }
    const flat = flattenEditedCard(doc, original)
    expect(flat.attrs).toEqual({ cardId: 'c1', color: '#8bad86', note: 'x' }) // 沿用原卡 attrs，不是拆出来那张的
    expect(flat.content).toHaveLength(2)
    expect(flat.content[0].content[0].text).toBe('第一段')
    expect(flat.content[1].content[0].text).toBe('意外拆出来的第二段')
  })

  it('压平后一个段落都不剩时兜底塞一个空段落，不会产出没有 content 的 card', () => {
    const original = multiParaCard('c1', ['x'])
    const doc = { type: 'doc', content: [] }
    const flat = flattenEditedCard(doc, original)
    expect(flat.content).toEqual([{ type: 'paragraph' }])
  })
})

describe('CardEditModal — 组件', () => {
  it('显示卡片首行为标题、完整多段内容（不是缩略预览），可编辑', async () => {
    const card = multiParaCard('c1', ['标题行', '第二段正文', '第三段正文'])
    render(<CardEditModal boxId="box-1" card={card} boxName="素材盒" onClose={() => {}} />)
    await tick()

    expect(screen.getByRole('dialog', { name: '标题行' })).toBeTruthy()
    expect(screen.getByText('第二段正文')).toBeTruthy()
    expect(screen.getByText('第三段正文')).toBeTruthy()

    const pm = document.querySelector('.card-edit-body .ProseMirror') as HTMLElement
    expect(pm).toBeTruthy()
    expect(pm.getAttribute('contenteditable')).toBe('true')
  })

  it('没有首行文字时用盒子名当标题', async () => {
    const card = { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph' }] }
    render(<CardEditModal boxId="box-1" card={card} boxName="空盒" onClose={() => {}} />)
    await tick()
    expect(screen.getByRole('dialog', { name: '空盒' })).toBeTruthy()
  })

  it('非只读：显示"插入正文"，点击后 carry 该卡并关闭', async () => {
    const box = useBookStore.getState().addBox('素材')!
    const card = multiParaCard('c1', ['文字'])
    useBookStore.getState().parkCard(box.id, card)
    let closed = false
    render(<CardEditModal boxId={box.id} card={card} boxName="素材" onClose={() => (closed = true)} />)
    await tick()

    const insertBtn = screen.getByText('插入正文').closest('button')!
    insertBtn.click()

    expect(useBookStore.getState().carried).toEqual({ boxId: box.id, cardId: 'c1' })
    expect(closed).toBe(true)
  })

  it('只读：不显示"插入正文"，但编辑器仍然可编辑', async () => {
    const card = multiParaCard('c1', ['文字'])
    render(<CardEditModal boxId="box-1" card={card} boxName="素材" onClose={() => {}} readOnly />)
    await tick()

    expect(screen.queryByText('插入正文')).toBeNull()
    const pm = document.querySelector('.card-edit-body .ProseMirror') as HTMLElement
    expect(pm.getAttribute('contenteditable')).toBe('true')
  })

  it('点击"关闭"调用 onClose', async () => {
    const card = multiParaCard('c1', ['文字'])
    let closed = false
    render(<CardEditModal boxId="box-1" card={card} boxName="素材" onClose={() => (closed = true)} />)
    await tick()
    screen.getByText('关闭').click()
    expect(closed).toBe(true)
  })
})
