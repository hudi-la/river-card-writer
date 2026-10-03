import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
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
import { zhFingerprint, UNCONFIRMED } from './enText'

function EnHarness({
  en,
  enSrc,
  onReady,
}: {
  en: string[] | null
  enSrc: string
  onReady?: (editor: Editor) => void
}) {
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
  onReady?.(editor)
  return <EditorContent editor={editor} />
}

function OneParaHarness({ style, en }: { style: string; en: string[] | null }) {
  const editor = useEditor({
    extensions: baseExtensions,
    immediatelyRender: false,
    content: {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0', en, enSrc: 'x' },
          content: [{ type: 'paragraph', attrs: { style }, content: [{ type: 'text', text: '标题' }] }],
        },
      ],
    },
  })
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardView 的英文栏', () => {
  it('每段英文是一个真的 <p>——这是每段首行缩进唯一可能的结构', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.', 'Three.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p')!
    const ps = field.querySelectorAll('p')
    expect(ps.length).toBe(3)
    expect(Array.from(ps).map((p) => p.textContent)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('整张卡只有一个编辑宿主，所以卡内能跨段自由拖选', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelectorAll('.card-en-p').length).toBe(1)
    expect(container.querySelector('.card-en-p')!.getAttribute('contenteditable')).toBeTruthy()
  })

  it('旧数据里并成一条的英文，一打开就恢复成多段——否则只有第一段能缩进', async () => {
    // 中间有一版"空行分段"，而作者段落之间敲的是单个回车，于是整张卡的英文被
    // 并成了数组里的一条。这是作者 2026-10-03 截图里看到的那个样子。
    const { container } = render(<EnHarness en={['One.\nTwo.\nThree.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const ps = container.querySelector('.card-en-p')!.querySelectorAll('p')
    expect(Array.from(ps).map((p) => p.textContent)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('没写过英文时标 data-empty，占位文字由 CSS 挂上去——不占一行', async () => {
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p')!
    expect(field.hasAttribute('data-empty')).toBe(true)
    expect(field.getAttribute('data-placeholder')).toBe('开始写…')
    expect(container.querySelector('[data-kind="invalidated"]')).toBeNull()
  })

  it('写了东西就不再是空态', async () => {
    const { container } = render(<EnHarness en={['One.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.card-en-p')!.hasAttribute('data-empty')).toBe(false)
  })

  it('形状不对（不是字符串数组）才当没写过', async () => {
    const { container } = render(<EnHarness en={'不是数组' as never} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.card-en-p')!.hasAttribute('data-empty')).toBe(true)
  })

  it('删掉一段中文不影响英文——段数本来就不再对应', async () => {
    let ed: Editor | undefined
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={'x'} onReady={(e) => (ed = e)} />)
    await new Promise((r) => setTimeout(r, 0))
    const doc = ed!.getJSON()
    doc.content![0].content = [doc.content![0].content![0]]
    ed!.commands.setContent(doc)
    await new Promise((r) => setTimeout(r, 0))
    const ps = container.querySelector('.card-en-p')!.querySelectorAll('p')
    expect(Array.from(ps).map((p) => p.textContent)).toEqual(['One.', 'Two.'])
  })

  it('打字后失焦，按块读回 DOM 写进 en，并盖 enAt', async () => {
    let ed: Editor | undefined
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} onReady={(e) => (ed = e)} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p') as HTMLElement
    // 模拟作者在里面敲了两段（回车在 contenteditable 里产生的就是真块）
    field.innerHTML = '<p>First para.</p><p>Second para.</p>'
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toEqual(['First para.', 'Second para.'])
    expect(attrs.enAt).toBeTruthy()
  })

  it('浏览器用 div 而不是 p 分块时照样读对——换浏览器不会变形', async () => {
    let ed: Editor | undefined
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} onReady={(e) => (ed = e)} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p') as HTMLElement
    field.innerHTML = 'First.<div>Second.</div>'
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['First.', 'Second.'])
  })

  it('万一有行内标签混进来，写回只剩文字——纯文本是硬保证', async () => {
    let ed: Editor | undefined
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} onReady={(e) => (ed = e)} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p') as HTMLElement
    field.innerHTML = '<p>plain <b>bold</b> <span style="font-size:40px">big</span></p>'
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['plain bold big'])
  })

  it('清空后退回"没写过"，而不是存一个空数组', async () => {
    let ed: Editor | undefined
    const { container } = render(<EnHarness en={['One.']} enSrc={'x'} onReady={(e) => (ed = e)} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p') as HTMLElement
    field.innerHTML = '<p><br></p>'
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toBeNull()
    expect(attrs.enSrc).toBe(UNCONFIRMED)
  })

  it('改自己的英文不撤销确认——作者修自己的字是在继续背书，不是推翻', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['One.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const stamp = ed!.getJSON().content![0].attrs!.enSrc
    const field = container.querySelector('.card-en-p') as HTMLElement
    field.innerHTML = '<p>One, revised.</p>'
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toEqual(['One, revised.'])
    expect(attrs.enSrc).toBe(stamp)
  })

  it('CRITICAL：值没变的重渲染绝不重写 DOM——否则光标被踢回第一个字', async () => {
    const { container, rerender } = render(<EnHarness en={['One.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const field = container.querySelector('.card-en-p') as HTMLElement
    // 模拟作者正在打字：DOM 里已经有了还没写回的内容
    field.innerHTML = '<p>One, half-typed…</p>'
    rerender(<EnHarness en={['One.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect((container.querySelector('.card-en-p') as HTMLElement).innerHTML).toBe('<p>One, half-typed…</p>')
  })

  it('整张卡只有一个中文段时跟着它的块样式走——标题卡的英文也是标题', async () => {
    const { container } = render(<OneParaHarness style="chapter" en={['The Title']} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.card-en-p')!.getAttribute('data-style')).toBe('chapter')
  })

  it('键盘事件不往上冒——否则 ProseMirror 的 keymap 会抢走 Backspace / Enter', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const cell = container.querySelector('.card-en-p') as HTMLTextAreaElement
    let reachedRoot = false
    container.addEventListener('keydown', () => { reachedRoot = true })
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(reachedRoot).toBe(false)
  })

  it('认过但中文又改了 → invalidated，并说明确认已失效', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={'f-旧的指纹'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')!.getAttribute('data-en-state')).toBe('invalidated')
    expect(container.textContent).toContain('确认已失效')
    expect(container.querySelector('.card-en-confirm button')?.textContent).toBe('重新确认')
  })

  it('写了但没确认 → unconfirmed，是中性状态：不报警、不涂灰，只给一个确认按钮', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={UNCONFIRMED} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')!.getAttribute('data-en-state')).toBe('unconfirmed')
    expect(container.textContent).not.toContain('失效')
    expect(container.querySelector('.card-en-confirm button')?.textContent).toBe('确认这一段')
  })

  it('点「确认这一段」盖上当前中文的指纹，状态变 confirmed', async () => {
    let ed: Editor | undefined
    function Wrap() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: { type: 'doc', content: [
          { type: 'card', attrs: { cardId: 'c0', en: ['One.'], enSrc: UNCONFIRMED },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
        ] },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))
    ;(container.querySelector('.card-en-confirm button') as HTMLButtonElement).click()
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.enSrc).toBe(zhFingerprint(['第一段']))
  })

  it('没写英文时不出现确认按钮——没东西可认', async () => {
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.card-en-confirm')).toBeNull()
  })

})
