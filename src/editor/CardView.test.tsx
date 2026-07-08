import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

function Harness({ onReady, threadId }: { onReady?: (editor: Editor) => void; threadId?: string | null }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0', threadId: threadId ?? null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
        { type: 'card', attrs: { cardId: 'c1', threadId: threadId ?? null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二' }] }] },
      ],
    },
  })
  if (editor) onReady?.(editor)
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardView', () => {
  it('每张卡渲染成带控制按钮的 section.card，正文可见', async () => {
    const { container } = render(<Harness />)
    await new Promise((r) => setTimeout(r, 0))
    const cards = container.querySelectorAll('section.card')
    expect(cards.length).toBe(2)
    expect(container.textContent).toContain('第一')
    expect(container.textContent).toContain('第二')
    // 控制按钮存在（用 data-card-ctrl 标记）
    expect(container.querySelectorAll('[data-card-ctrl="up"]').length).toBe(2)
    expect(container.querySelectorAll('[data-card-ctrl="add"]').length).toBe(2)
  })

  it('点击第二张卡的 ✕（合并进上一张）会把两张卡的正文合并成一张，保留上一张的 cardId', async () => {
    let editorRef: Editor | null = null
    const { container } = render(<Harness onReady={(e) => (editorRef = e)} />)
    await new Promise((r) => setTimeout(r, 0))

    const mergeButtons = container.querySelectorAll('[data-card-ctrl="merge"]')
    expect(mergeButtons.length).toBe(2)
    // 按钮用 onMouseDown 绑定（避免抢焦点/失焦时机问题），所以要 dispatch mousedown
    fireEvent.mouseDown(mergeButtons[1])
    await new Promise((r) => setTimeout(r, 0))

    const cards = editorRef!.getJSON().content!
    expect(cards.length).toBe(1)
    expect(cards[0].attrs?.cardId).toBe('c0')
    const texts = cards[0].content!.map((p: any) => p.content?.[0]?.text)
    expect(texts).toEqual(['第一', '第二'])
  })

  it('相同 threadId 的两张卡都带 data-thread-id（相等）且内联 style 含 --thread', async () => {
    useBookStore.getState().__resetForTest()
    const thread = useBookStore.getState().addThread('主线', '#7fa3c4')
    const { container } = render(<Harness threadId={thread.id} />)
    await new Promise((r) => setTimeout(r, 0))

    const cards = container.querySelectorAll('section.card[data-thread-id]')
    expect(cards.length).toBe(2)
    expect((cards[0] as HTMLElement).dataset.threadId).toBe(thread.id)
    expect((cards[1] as HTMLElement).dataset.threadId).toBe(thread.id)
    expect((cards[0] as HTMLElement).style.getPropertyValue('--thread')).toBe(thread.color)
    expect((cards[1] as HTMLElement).style.getPropertyValue('--thread')).toBe(thread.color)
  })
})
