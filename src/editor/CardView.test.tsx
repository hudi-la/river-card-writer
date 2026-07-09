import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { baseExtensions, autoCardColor, CARD_PALETTE } from './schema'

function Harness({ onReady, color }: { onReady?: (editor: Editor) => void; color?: string | null }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        { type: 'card', attrs: { cardId: 'c0', color: color ?? null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
        { type: 'card', attrs: { cardId: 'c1', color: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二' }] }] },
      ],
    },
  })
  if (editor) onReady?.(editor)
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardView', () => {
  it('每张卡渲染成 section.card，正文可见，且不再有任何控制簇按钮/菜单', async () => {
    const { container } = render(<Harness />)
    await new Promise((r) => setTimeout(r, 0))

    const cards = container.querySelectorAll('section.card')
    expect(cards.length).toBe(2)
    expect(container.textContent).toContain('第一')
    expect(container.textContent).toContain('第二')

    // 整簇（▲▼＋✕●⇢Aa 及其弹出菜单）必须彻底消失
    expect(container.querySelectorAll('[data-card-ctrl]').length).toBe(0)
    expect(container.querySelector('.card-ctrls')).toBeNull()
    expect(container.querySelector('.thread-menu')).toBeNull()
    expect(container.querySelector('.box-menu')).toBeNull()
    expect(container.querySelector('.role-menu')).toBeNull()
  })

  it('没手动设色的卡带来自 autoCardColor(cardId) 的稳定底色', async () => {
    const { container } = render(<Harness />)
    await new Promise((r) => setTimeout(r, 0))

    const cards = container.querySelectorAll('section.card')
    cards.forEach((c) => {
      const el = c as HTMLElement
      expect(el.hasAttribute('data-color')).toBe(false)
      const bg = el.style.getPropertyValue('--card-bg')
      expect(bg).not.toBe('')
      expect(CARD_PALETTE).toContain(bg)
    })
    expect((cards[0] as HTMLElement).style.getPropertyValue('--card-bg')).toBe(autoCardColor('c0'))
    expect((cards[1] as HTMLElement).style.getPropertyValue('--card-bg')).toBe(autoCardColor('c1'))
  })

  it('手动设了 color 的卡直接用该颜色打底，并带 data-color', async () => {
    const { container } = render(<Harness color="#8bad86" />)
    await new Promise((r) => setTimeout(r, 0))

    const first = container.querySelector('section.card[data-card-id="c0"]') as HTMLElement
    expect(first.getAttribute('data-color')).toBe('#8bad86')
    expect(first.style.getPropertyValue('--card-bg')).toBe('#8bad86')
  })

  it('⠿ 拖拽把手仍然可用：卡片有 data-card-id，供 RiverEditor 的把手命中区判定拖拽', async () => {
    let editorRef: Editor | null = null
    const { container } = render(<Harness onReady={(e) => (editorRef = e)} />)
    await new Promise((r) => setTimeout(r, 0))
    const cards = container.querySelectorAll('section.card')
    expect(cards[0].getAttribute('data-card-id')).toBe('c0')
    expect(cards[1].getAttribute('data-card-id')).toBe('c1')
    expect(editorRef).toBeTruthy()
  })
})
