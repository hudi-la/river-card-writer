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

// ── 译前备料：英文栏 ──────────────────────────────────────────────
import { zhFingerprint, STALE_SRC } from './enText'

function EnHarness({ en, enSrc }: { en: string[] | null; enSrc: string }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0', en, enSrc },
          content: [
            { type: 'paragraph', attrs: { style: 'chapter' }, content: [{ type: 'text', text: '第一段' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '第二段' }] },
          ],
        },
      ],
    },
  })
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardView 的英文栏', () => {
  it('每张卡都渲染出 aside.card-en，段数跟中文一致', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const aside = container.querySelector('aside.card-en')
    expect(aside).not.toBeNull()
    expect(aside!.querySelectorAll('.card-en-p').length).toBe(2)
    expect(aside!.textContent).toContain('One.')
    expect(aside!.textContent).toContain('Two.')
  })

  it('英文段落从对应的中文段继承 data-style——英文自己不存样式', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const ps = container.querySelectorAll('aside.card-en .card-en-p')
    expect(ps[0].getAttribute('data-style')).toBe('chapter')
    expect(ps[1].getAttribute('data-style')).toBe('body')
  })

  it('没写过英文时每段给一个空的可写格子，不显示过期', async () => {
    const { container } = render(<EnHarness en={null} enSrc={STALE_SRC} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelectorAll('aside.card-en .card-en-p').length).toBe(2)
    expect(container.querySelector('section.card')!.getAttribute('data-en-stale')).toBeNull()
  })

  it('中文改过、指纹对不上时，卡上出现 data-en-stale', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={'f-旧的指纹'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')!.getAttribute('data-en-stale')).toBe('true')
    expect(container.textContent).toContain('已过期')
  })

  it('脏 en（段数不符）当没写过处理，绝不渲染出对不上的英文', async () => {
    const { container } = render(<EnHarness en={['Only one.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const aside = container.querySelector('aside.card-en')!
    expect(aside.querySelectorAll('.card-en-p').length).toBe(2)
    expect(aside.textContent).not.toContain('Only one.')
  })

  it('在英文格子里打字后失焦，写回 card 的 en 属性并盖 enAt', async () => {
    let ed: Editor | undefined
    function Wrap() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: {
          type: 'doc',
          content: [
            { type: 'card', attrs: { cardId: 'c0', en: null, enSrc: STALE_SRC },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
          ],
        },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))

    const cell = container.querySelector('.card-en-p') as HTMLElement
    cell.textContent = 'The cat barred the door.'
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toEqual(['The cat barred the door.'])
    expect(attrs.enSrc).toBe(zhFingerprint(['第一段']))
    expect(attrs.enAt).not.toBe('')
  })

  it('把英文清空后退回"没写过"，而不是存一个全是空串的数组', async () => {
    let ed: Editor | undefined
    function Wrap() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: {
          type: 'doc',
          content: [
            { type: 'card', attrs: { cardId: 'c0', en: ['One.'], enSrc: zhFingerprint(['第一段']) },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
          ],
        },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))

    const cell = container.querySelector('.card-en-p') as HTMLElement
    cell.textContent = '   '
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toBe(null)
    expect(attrs.enSrc).toBe('')
  })
})
