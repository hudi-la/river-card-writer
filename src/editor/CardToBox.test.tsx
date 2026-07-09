import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

function Harness({ onReady, threadId }: { onReady?: (editor: Editor) => void; threadId: string | null }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0', threadId }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一张' }] }] },
        { type: 'card', attrs: { cardId: 'c1', threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二张' }] }] },
      ],
    },
  })
  if (editor) onReady?.(editor)
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardToBox', () => {
  beforeEach(() => {
    useBookStore.getState().__resetForTest()
  })

  it('点第一张卡的 ⇢ 按钮，选中已有盒子，卡片移入盒子并从编辑器删除', async () => {
    const thread = useBookStore.getState().addThread('人物')
    const box = useBookStore.getState().addBox('素材盒')

    let editorRef: Editor | null = null
    const { container } = render(<Harness onReady={(e) => (editorRef = e)} threadId={thread.id} />)
    await new Promise((r) => setTimeout(r, 0))

    const toBoxBtns = container.querySelectorAll('[data-card-ctrl="tobox"]')
    expect(toBoxBtns.length).toBe(2)
    fireEvent.mouseDown(toBoxBtns[0])
    await new Promise((r) => setTimeout(r, 0))

    const boxBtn = Array.from(container.querySelectorAll('.box-menu button')).find((b) => b.textContent === box.name)
    expect(boxBtn).toBeTruthy()
    fireEvent.mouseDown(boxBtn!)
    await new Promise((r) => setTimeout(r, 0))

    const updatedBox = useBookStore.getState().getBox(box.id)!
    expect(updatedBox.cards.length).toBe(1)
    expect(updatedBox.cards[0].attrs.threadId).toBe(thread.id)
    expect(updatedBox.cards[0].content[0].content[0].text).toBe('第一张')

    expect(editorRef!.getJSON().content!.length).toBe(1)
    expect(editorRef!.getJSON().content![0].attrs.cardId).toBe('c1')
  })

  it('点 ⇢ 按钮，选"＋新盒子"，新建盒子并把卡片放入', async () => {
    let editorRef: Editor | null = null
    const { container } = render(<Harness onReady={(e) => (editorRef = e)} threadId={null} />)
    await new Promise((r) => setTimeout(r, 0))

    const toBoxBtns = container.querySelectorAll('[data-card-ctrl="tobox"]')
    fireEvent.mouseDown(toBoxBtns[0])
    await new Promise((r) => setTimeout(r, 0))

    const newBoxBtn = Array.from(container.querySelectorAll('.box-menu button')).find((b) => b.textContent === '＋新盒子')
    expect(newBoxBtn).toBeTruthy()
    fireEvent.mouseDown(newBoxBtn!)
    await new Promise((r) => setTimeout(r, 0))

    const boxes = useBookStore.getState().book.boxes
    expect(boxes.length).toBe(1)
    expect(boxes[0].name).toBe('新盒子')
    expect(boxes[0].cards.length).toBe(1)
    expect(editorRef!.getJSON().content!.length).toBe(1)
  })
})
