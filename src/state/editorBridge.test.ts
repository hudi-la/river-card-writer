import { describe, it, expect, beforeEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from '../editor/schema'
import { useBookStore } from './bookStore'
import { useEditorBridge } from './editorBridge'

// parkOutlineCardToBox 是大纲块行拖到盒子那条新路径的落点——镜像
// src/editor/CardToBox.test.tsx 验证的"正文卡片拖到盒子"逻辑（park-then-remove /
// 单卡边界先落袋再补卡），只是入口从"拖拽命中的 cardId"换成"doc.content 第
// cardIndex 张卡"。用真实 Editor 实例（不 mock TipTap），跟 CardToBox.test.tsx
// 同一个套路。

function docWithCards(ids: string[]) {
  return {
    type: 'doc',
    content: ids.map((id) => ({
      type: 'card',
      attrs: { cardId: id },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `文字-${id}` }] }],
    })),
  }
}

describe('editorBridge.parkOutlineCardToBox', () => {
  beforeEach(() => {
    useBookStore.getState().__resetForTest()
    useBookStore.getState().openBook(useBookStore.getState().library.books[0].id)
    useEditorBridge.getState().setEditor(null)
  })

  it('多卡文档：把第 cardIndex 张块卡从文档摘除、park 进目标盒子；cardId 不变，文档+盒子总数守恒', () => {
    const box = useBookStore.getState().addBox('素材盒')!
    const editor = new Editor({ extensions: baseExtensions, content: docWithCards(['c0', 'c1', 'c2']) })
    useEditorBridge.getState().setEditor(editor)

    const ok = useEditorBridge.getState().parkOutlineCardToBox(1, box.id)
    expect(ok).toBe(true)

    const content = editor.getJSON().content!
    expect(content.length).toBe(2)
    expect(content.map((c: any) => c.attrs.cardId)).toEqual(['c0', 'c2'])

    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1)
    expect(updatedBox.cards[0].attrs.cardId).toBe('c1')
    expect(updatedBox.cards[0].content[0].content[0].text).toBe('文字-c1')

    editor.destroy()
  })

  it('新建一个盒子，park 进去（跟 CardToBox.test.tsx「新建一个盒子，再 park 进去」对应的大纲路径版本）', () => {
    const editor = new Editor({ extensions: baseExtensions, content: docWithCards(['c0', 'c1']) })
    useEditorBridge.getState().setEditor(editor)
    const box = useBookStore.getState().addBox('新盒子')!

    const ok = useEditorBridge.getState().parkOutlineCardToBox(0, box.id)
    expect(ok).toBe(true)

    const boxes = useBookStore.getState().activeBook()!.boxes
    expect(boxes.length).toBe(1)
    expect(boxes[0].cards.length).toBe(1)
    expect(boxes[0].cards[0].attrs.cardId).toBe('c0')
    expect(editor.getJSON().content!.length).toBe(1)
    expect(editor.getJSON().content![0].attrs.cardId).toBe('c1')

    editor.destroy()
  })

  it('单卡边界：文档只剩这一张卡时，先落袋（park）、再补一张空卡撑住"文档非空"、最后摘掉原卡——内容全程不悬空', () => {
    const box = useBookStore.getState().addBox('素材盒')!
    const editor = new Editor({ extensions: baseExtensions, content: docWithCards(['only']) })
    useEditorBridge.getState().setEditor(editor)

    const ok = useEditorBridge.getState().parkOutlineCardToBox(0, box.id)
    expect(ok).toBe(true)

    // 文档非空（appendCard 补的那张空卡撑住了），但原卡已经不在文档里了。
    const content = editor.getJSON().content!
    expect(content.length).toBe(1)
    expect(content[0].attrs.cardId).not.toBe('only')

    // 原卡的内容完整落进了盒子。
    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1)
    expect(updatedBox.cards[0].attrs.cardId).toBe('only')
    expect(updatedBox.cards[0].content[0].content[0].text).toBe('文字-only')

    editor.destroy()
  })

  it('cardIndex 越界——no-op，返回 false，文档和盒子都不受影响', () => {
    const box = useBookStore.getState().addBox('素材盒')!
    const editor = new Editor({ extensions: baseExtensions, content: docWithCards(['c0']) })
    useEditorBridge.getState().setEditor(editor)

    expect(useEditorBridge.getState().parkOutlineCardToBox(5, box.id)).toBe(false)
    expect(useEditorBridge.getState().parkOutlineCardToBox(-1, box.id)).toBe(false)

    expect(useBookStore.getState().getBox(box.id)!.cards.length).toBe(0)
    expect(editor.getJSON().content!.length).toBe(1)
    expect(editor.getJSON().content![0].attrs.cardId).toBe('c0')

    editor.destroy()
  })

  it('没有挂载的 editor——no-op，返回 false，不抛异常', () => {
    useEditorBridge.getState().setEditor(null)
    expect(useEditorBridge.getState().parkOutlineCardToBox(0, 'whatever-box-id')).toBe(false)
  })
})
