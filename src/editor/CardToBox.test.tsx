import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

// 收进盒子（"park"）现在是通过 RiverEditor 里 ⠿ 的真拖拽——把手拖到左栏某个
// [data-box-id] 元素上——而不是点按钮选菜单。真实拖拽（pointerdown/move/up +
// getBoundingClientRect）在 jsdom 里没什么好模拟的，所以这里直接验证 RiverEditor
// 在命中盒子时实际调用的那两步原语组合：removeCard() 命令 + store.parkCard()，
// 行为上等价于「dropEl 命中 [data-box-id] → park + removeCard」这条分支。

function twoCards() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一张' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二张' }] }] },
      ],
    },
  })
}

function caretInCard(editor: Editor, cardId: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'card' && node.attrs.cardId === cardId) pos = p + 2
  })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

function jsonOfCard(editor: Editor, cardId: string): any {
  let json: any = null
  editor.state.doc.forEach((node) => {
    if (node.attrs.cardId === cardId) json = node.toJSON()
  })
  return json
}

describe('拖到盒子：removeCard + store.parkCard 组合', () => {
  beforeEach(() => {
    useBookStore.getState().__resetForTest()
    useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
  })

  it('把第一张卡从编辑器移除，再 park 进指定盒子；正文只剩另一张', () => {
    const box = useBookStore.getState().addBox('素材盒')
    const editor = twoCards()
    caretInCard(editor, 'c0')
    const json = jsonOfCard(editor, 'c0')

    const removed = editor.commands.removeCard()
    expect(removed).toBe(true)
    if (removed) useBookStore.getState().parkCard(box.id, json)

    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1)
    expect(updatedBox.cards[0].attrs.cardId).toBe('c0')
    expect(updatedBox.cards[0].content[0].content[0].text).toBe('第一张')

    expect(editor.getJSON().content!.length).toBe(1)
    expect(editor.getJSON().content![0].attrs.cardId).toBe('c1')
    editor.destroy()
  })

  it('新建一个盒子，再 park 进去', () => {
    const editor = twoCards()
    caretInCard(editor, 'c0')
    const json = jsonOfCard(editor, 'c0')

    const box = useBookStore.getState().addBox('新盒子')
    const removed = editor.commands.removeCard()
    expect(removed).toBe(true)
    if (removed) useBookStore.getState().parkCard(box.id, json)

    const boxes = useBookStore.getState().activeBook()!.boxes
    expect(boxes.length).toBe(1)
    expect(boxes[0].name).toBe('新盒子')
    expect(boxes[0].cards.length).toBe(1)
    expect(editor.getJSON().content!.length).toBe(1)
    editor.destroy()
  })

  it('文档只剩最后一张卡时，removeCard 拒绝执行——不应该出现"卡消失了但也没进盒子"的悬空态', () => {
    const box = useBookStore.getState().addBox('素材盒')
    const editor = new Editor({
      extensions: baseExtensions,
      content: {
        type: 'doc',
        content: [
          { type: 'card', attrs: { cardId: 'only' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '唯一一张' }] }] },
        ],
      },
    })
    caretInCard(editor, 'only')
    const json = jsonOfCard(editor, 'only')

    const removed = editor.commands.removeCard()
    expect(removed).toBe(false)
    if (removed) useBookStore.getState().parkCard(box.id, json)

    expect(useBookStore.getState().getBox(box.id)!.cards).toEqual([])
    expect(editor.getJSON().content!.length).toBe(1)
    expect(editor.getJSON().content![0].attrs.cardId).toBe('only')
    editor.destroy()
  })
})
