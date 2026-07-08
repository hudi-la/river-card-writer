import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

function Harness({ onReady }: { onReady?: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0', threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
      ],
    },
  })
  if (editor) onReady?.(editor)
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardThreadMenu', () => {
  beforeEach(() => {
    useBookStore.getState().__resetForTest()
  })

  it('点●按钮打开菜单，点"＋新建线"输入"语言"回车，新建线并把本卡设成该线', async () => {
    let editorRef: Editor | null = null
    const { container } = render(<Harness onReady={(e) => (editorRef = e)} />)
    await new Promise((r) => setTimeout(r, 0))

    const threadBtn = container.querySelector('[data-card-ctrl="thread"]')
    expect(threadBtn).toBeTruthy()
    fireEvent.mouseDown(threadBtn!)
    await new Promise((r) => setTimeout(r, 0))

    const newBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '＋ 新建线')
    expect(newBtn).toBeTruthy()
    fireEvent.mouseDown(newBtn!)
    await new Promise((r) => setTimeout(r, 0))

    const input = container.querySelector('.thread-menu input') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: '语言' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))

    const threads = useBookStore.getState().book.threads
    expect(threads.length).toBe(1)
    expect(threads[0].name).toBe('语言')

    const cardJson = editorRef!.getJSON().content![0]
    expect(cardJson.attrs?.threadId).toBe(threads[0].id)
  })
})
