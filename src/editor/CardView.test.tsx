import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import { baseExtensions } from './schema'

function Harness() {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二' }] }] },
      ],
    },
  })
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
})
