import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { baseExtensions } from './schema'
import { useBookStore, THREAD_PALETTE } from '../state/bookStore'

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

function OneCardHarness({ onReady }: { onReady?: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'only', threadId: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '唯一一张' }] }] },
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
    // 挂了线的卡不应该再被当成"未挂线"打自动色标记
    expect((cards[0] as HTMLElement).hasAttribute('data-auto-color')).toBe(false)
    expect((cards[1] as HTMLElement).hasAttribute('data-auto-color')).toBe(false)
  })

  it('没挂线的卡带 data-auto-color，且内联 --thread 是调色板里的一个稳定颜色', async () => {
    useBookStore.getState().__resetForTest()
    const { container } = render(<Harness threadId={null} />)
    await new Promise((r) => setTimeout(r, 0))

    const cards = container.querySelectorAll('section.card')
    expect(cards.length).toBe(2)
    cards.forEach((c) => {
      const el = c as HTMLElement
      expect(el.hasAttribute('data-thread-id')).toBe(false)
      expect(el.hasAttribute('data-auto-color')).toBe(true)
      const color = el.style.getPropertyValue('--thread')
      expect(THREAD_PALETTE).toContain(color)
    })
    // 同一次渲染里两张不同 cardId 的卡，颜色来自哈希，未必相同——但两张卡各自都必须
    // 稳定地落在调色板里（上面已验证），这里只再确认两者都拿到了非空颜色。
    expect((cards[0] as HTMLElement).style.getPropertyValue('--thread')).not.toBe('')
    expect((cards[1] as HTMLElement).style.getPropertyValue('--thread')).not.toBe('')
  })

  it('章里只有一张卡时，点⇢收进盒子不应产生重复：盒子仍为空，卡仍留在正文里', async () => {
    useBookStore.getState().__resetForTest()
    const box = useBookStore.getState().addBox('素材盒')

    let editorRef: Editor | null = null
    const { container } = render(<OneCardHarness onReady={(e) => (editorRef = e)} />)
    await new Promise((r) => setTimeout(r, 0))

    const toBoxBtn = container.querySelector('[data-card-ctrl="tobox"]')!
    fireEvent.mouseDown(toBoxBtn)
    await new Promise((r) => setTimeout(r, 0))

    const boxBtn = Array.from(container.querySelectorAll('.box-menu button')).find((b) => b.textContent === box.name)
    expect(boxBtn).toBeTruthy()
    fireEvent.mouseDown(boxBtn!)
    await new Promise((r) => setTimeout(r, 0))

    // removeCard refuses to remove the last card, so parkCard must not run either.
    expect(useBookStore.getState().getBox(box.id)!.cards).toEqual([])
    expect(editorRef!.getJSON().content!.length).toBe(1)
    expect(editorRef!.getJSON().content![0].attrs.cardId).toBe('only')
  })

  it('role:"heading" 的卡渲染出 section.card[data-role="heading"]', async () => {
    function RoleHarness() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: {
          type: 'doc',
          content: [
            { type: 'card', attrs: { cardId: 'r0', role: 'heading' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '标题' }] }] },
          ],
        },
      })
      if (!editor) return null
      return <EditorContent editor={editor} />
    }
    const { container } = render(<RoleHarness />)
    await new Promise((r) => setTimeout(r, 0))
    const card = container.querySelector('section.card[data-role="heading"]')
    expect(card).toBeTruthy()
  })
})
