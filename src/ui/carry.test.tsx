import { describe, it, expect, beforeEach } from 'vitest'
import { useBookStore } from '../state/bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
  useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
})

function cardJSON(cardId: string, text: string) {
  return { type: 'card', attrs: { cardId, color: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

describe('carry / cancelCarry / dropCarried', () => {
  it('carry(boxId, cardId) 后 carried 非空、盒子不变（卡还在盒里）、viewKind 切回 doc（单文档）', () => {
    const box = useBookStore.getState().addBox('素材')
    const card = cardJSON('c1', '装载测试')
    useBookStore.getState().parkCard(box.id, card)
    useBookStore.getState().openBox(box.id)

    useBookStore.getState().carry(box.id, 'c1')

    const s = useBookStore.getState()
    expect(s.carried).toEqual({ boxId: box.id, cardId: 'c1' })
    // 非破坏性：carry 本身不从盒子里拿走卡，直到真正落定才移除
    expect(s.getBox(box.id)!.cards).toEqual([card])
    expect(s.viewKind).toBe('doc')
  })

  it('cancelCarry() 只清空 carried，卡从未离开盒子，原样还在', () => {
    const box = useBookStore.getState().addBox('素材')
    const card = cardJSON('c1', '装载测试')
    useBookStore.getState().parkCard(box.id, card)
    useBookStore.getState().carry(box.id, 'c1')

    useBookStore.getState().cancelCarry()

    const s = useBookStore.getState()
    expect(s.carried).toBeNull()
    expect(s.getBox(box.id)!.cards).toEqual([card])
  })

  it('dropCarried() 仅清空 carried 引用', () => {
    const box = useBookStore.getState().addBox('素材')
    useBookStore.getState().parkCard(box.id, cardJSON('c1', '装载测试'))
    useBookStore.getState().carry(box.id, 'c1')

    useBookStore.getState().dropCarried()

    const s = useBookStore.getState()
    expect(s.carried).toBeNull()
  })

  it('先 carry 第一张卡，再 carry 第二张卡（还没落定）：两张卡都还完整地留在各自盒子里，第一张没有丢', () => {
    const boxA = useBookStore.getState().addBox('盒子A')
    const boxB = useBookStore.getState().addBox('盒子B')
    const cardA = cardJSON('a1', '来自A')
    const cardB = cardJSON('b1', '来自B')
    useBookStore.getState().parkCard(boxA.id, cardA)
    useBookStore.getState().parkCard(boxB.id, cardB)

    useBookStore.getState().carry(boxA.id, 'a1')
    // 还没落定，就换成携带另一张卡（替换引用）
    useBookStore.getState().carry(boxB.id, 'b1')

    const s = useBookStore.getState()
    expect(s.carried).toEqual({ boxId: boxB.id, cardId: 'b1' })
    // 因为 carry 从不移除，两张卡都还在各自的盒子里，第一张没有被覆盖/丢失
    expect(s.getBox(boxA.id)!.cards).toEqual([cardA])
    expect(s.getBox(boxB.id)!.cards).toEqual([cardB])
  })

  it('模拟真正落定：drop 时才从盒子里移除（takeCardFromBox），移除后盒子清空', () => {
    const box = useBookStore.getState().addBox('素材')
    const card = cardJSON('c1', '装载测试')
    useBookStore.getState().parkCard(box.id, card)
    useBookStore.getState().carry(box.id, 'c1')

    // drop 流程：先按 carried 引用查到卡，插入正文后才调用 takeCardFromBox 真正移除
    const s1 = useBookStore.getState()
    const found = s1.getBox(s1.carried!.boxId)!.cards.find((c) => c.attrs.cardId === s1.carried!.cardId)
    expect(found).toEqual(card)
    const taken = useBookStore.getState().takeCardFromBox(s1.carried!.boxId, s1.carried!.cardId)
    expect(taken).toEqual(card)
    useBookStore.getState().dropCarried()

    const s2 = useBookStore.getState()
    expect(s2.carried).toBeNull()
    expect(s2.getBox(box.id)!.cards).toEqual([])
  })
})
