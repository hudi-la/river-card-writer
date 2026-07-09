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

describe('CardRoleMenu', () => {
  beforeEach(() => {
    useBookStore.getState().__resetForTest()
  })

  it('点角色按钮打开菜单，点"小标题" → 该卡 role 变为 heading', async () => {
    let editorRef: Editor | null = null
    const { container } = render(<Harness onReady={(e) => (editorRef = e)} />)
    await new Promise((r) => setTimeout(r, 0))

    const roleBtn = container.querySelector('[data-card-ctrl="role"]')
    expect(roleBtn).toBeTruthy()
    fireEvent.mouseDown(roleBtn!)
    await new Promise((r) => setTimeout(r, 0))

    const headingBtn = Array.from(container.querySelectorAll('.role-menu button')).find((b) => b.textContent === '小标题')
    expect(headingBtn).toBeTruthy()
    fireEvent.mouseDown(headingBtn!)
    await new Promise((r) => setTimeout(r, 0))

    const cardJson = editorRef!.getJSON().content![0]
    expect(cardJson.attrs?.role).toBe('heading')
  })
})
