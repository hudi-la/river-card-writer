import { describe, it, expect, beforeEach } from 'vitest'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

function cardJSON(cardId: string, text: string) {
  return { type: 'card', attrs: { cardId, threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('carry / cancelCarry / dropCarried', () => {
  it('carry(boxId, cardId) 后 carried 非空、盒里少一张、viewKind 切回 chapter', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '装载测试'))
    useBookStore.getState().openBox(box.id)

    useBookStore.getState().carry(box.id, 'c1')

    const s = useBookStore.getState()
    expect(s.carried).toBeTruthy()
    expect(s.carried!.boxId).toBe(box.id)
    expect(s.carried!.card.attrs.cardId).toBe('c1')
    expect(s.getBox(box.id)!.cards).toEqual([])
    expect(s.viewKind).toBe('chapter')
  })

  it('cancelCarry() 把卡放回原盒、清空 carried', () => {
    const box = useBookStore.getState().addBox('素材')
    const card = cardJSON('c1', '装载测试')
    useBookStore.getState().parkCard(box.id, card)
    useBookStore.getState().carry(box.id, 'c1')

    useBookStore.getState().cancelCarry()

    const s = useBookStore.getState()
    expect(s.carried).toBeNull()
    expect(s.getBox(box.id)!.cards).toEqual([card])
  })

  it('dropCarried() 仅清空 carried（卡已被插入正文，不放回盒子）', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '装载测试'))
    useBookStore.getState().carry(box.id, 'c1')

    useBookStore.getState().dropCarried()

    const s = useBookStore.getState()
    expect(s.carried).toBeNull()
    expect(s.getBox(box.id)!.cards).toEqual([])
  })
})
