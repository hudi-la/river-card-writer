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

describe('CardView 的英文栏', () => {
  it('每张卡都渲染出 aside.card-en，段数跟中文一致', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const aside = container.querySelector('aside.card-en')
    expect(aside).not.toBeNull()
    expect(aside!.querySelectorAll('.card-en-p').length).toBe(2)
    const vals = Array.from(aside!.querySelectorAll('.card-en-p')).map((c) => (c as HTMLTextAreaElement).value)
    expect(vals).toEqual(['One.', 'Two.'])
  })

  it('英文段落从对应的中文段继承 data-style——英文自己不存样式', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const ps = container.querySelectorAll('aside.card-en .card-en-p')
    expect(ps[0].getAttribute('data-style')).toBe('chapter')
    expect(ps[1].getAttribute('data-style')).toBe('body')
  })

  it('没写过英文时每段给一个空的可写格子，不显示过期', async () => {
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelectorAll('aside.card-en .card-en-p').length).toBe(2)
    expect(container.querySelector('section.card')!.getAttribute('data-en-stale')).toBeNull()
  })

  it('空态用 placeholder，不另起一行「还没写」——否则空格子和那句话同时出现', async () => {
    const { container } = render(<EnHarness en={null} enSrc={UNCONFIRMED} />)
    await new Promise((r) => setTimeout(r, 0))
    const cells = container.querySelectorAll('aside.card-en .card-en-p')
    expect((cells[0] as HTMLTextAreaElement).placeholder).toBe('开始写…')
    // 只第一格给提示，不是每格都挂一遍
    expect((cells[1] as HTMLTextAreaElement).placeholder).toBe('')
    expect(container.querySelector('.card-en-empty')).toBeNull()
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

  it('段数对不上时英文照样在——删掉一段中文不该让英文消失', async () => {
    // 两段中文，但英文有三段（比如作者删了一段中文）
    const { container } = render(<EnHarness en={['One.', 'Two.', 'Three.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const vals = Array.from(container.querySelectorAll('.card-en-p')).map((c) => (c as HTMLTextAreaElement).value)
    expect(vals).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('英文比中文少时补空格子，已有的不动', async () => {
    const { container } = render(<EnHarness en={['One.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const vals = Array.from(container.querySelectorAll('.card-en-p')).map((c) => (c as HTMLTextAreaElement).value)
    expect(vals).toEqual(['One.', ''])
  })

  it('段数对不上时打字，绝不把已有英文覆盖成空串——这是会丢数据的那条路', async () => {
    let ed: Editor | undefined
    function Wrap() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: { type: 'doc', content: [
          // 一段中文，三段英文——作者刚删掉两段中文的样子
          { type: 'card', attrs: { cardId: 'c0', en: ['One.', 'Two.', 'Three.'], enSrc: 'x' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
        ] },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))

    const cell = container.querySelector('.card-en-p') as HTMLTextAreaElement
    cell.value = 'One, revised.'
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    // 改了第一段，另外两段原封不动——原来这里会变成 ['One, revised.'] 把后两段抹掉
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['One, revised.', 'Two.', 'Three.'])
  })

  it('形状不对（不是字符串数组）才当没写过', async () => {
    const { container } = render(<EnHarness en={'不是数组' as never} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const vals = Array.from(container.querySelectorAll('.card-en-p')).map((c) => (c as HTMLTextAreaElement).value)
    expect(vals).toEqual(['', ''])
  })

  it('英文格子是 textarea，不是 contentEditable——HTML 和字号从结构上就进不来', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const cells = container.querySelectorAll('.card-en-p')
    expect(cells.length).toBe(2)
    expect(Array.from(cells).every((c) => c.tagName === 'TEXTAREA')).toBe(true)
    expect(Array.from(cells).every((c) => !c.hasAttribute('contenteditable'))).toBe(true)
    expect((cells[0] as HTMLTextAreaElement).value).toBe('One.')
  })

  it('每个格子外面有个影子元素带着同一份文字——高度靠它撑开，不靠 JS 量', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const cells = container.querySelectorAll('.card-en-cell')
    expect(cells.length).toBe(2)
    expect(Array.from(cells).map((c) => c.getAttribute('data-value'))).toEqual(['One.', 'Two.'])
  })

  it('段首按 Backspace，这一段并进上一段，光标落在接缝上', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const tas = container.querySelectorAll('.card-en-p')
    const second = tas[1] as HTMLTextAreaElement
    second.focus()
    second.setSelectionRange(0, 0)
    fireEvent.keyDown(second, { key: 'Backspace' })
    await new Promise((r) => setTimeout(r, 0))

    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['One. Two.'])
    // 光标回到接缝：第一格、'One. ' 之后
    const first = container.querySelectorAll('.card-en-p')[0] as HTMLTextAreaElement
    expect(document.activeElement).toBe(first)
    expect(first.selectionStart).toBe('One. '.length)
  })

  it('段首 Backspace 用的是格子里的实时文字，不是写回过的旧值', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const second = container.querySelectorAll('.card-en-p')[1] as HTMLTextAreaElement
    // 刚敲完就退格，还没失焦——写回还没发生
    second.value = 'Two, just typed.'
    fireEvent.input(second)
    second.focus()
    second.setSelectionRange(0, 0)
    fireEvent.keyDown(second, { key: 'Backspace' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['One. Two, just typed.'])
  })

  it('段尾按 Delete，把下一段并进来——同一道缝，从另一侧发起', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const first = container.querySelectorAll('.card-en-p')[0] as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(first.value.length, first.value.length)
    fireEvent.keyDown(first, { key: 'Delete' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['One. Two.'])
  })

  it('第一段的段首 Backspace 不合段，也不吞掉按键', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const first = container.querySelectorAll('.card-en-p')[0] as HTMLTextAreaElement
    first.focus()
    first.setSelectionRange(0, 0)
    const ev = fireEvent.keyDown(first, { key: 'Backspace' })
    expect(ev).toBe(true) // 没有 preventDefault
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['One.', 'Two.'])
  })

  it('有选区时的 Backspace 照常删选中的字，不合段', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const second = container.querySelectorAll('.card-en-p')[1] as HTMLTextAreaElement
    second.focus()
    second.setSelectionRange(0, 3) // 选中 'Two'
    fireEvent.keyDown(second, { key: 'Backspace' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['One.', 'Two.'])
  })

  it('中文那边没有对应段落的多余段，能用 Backspace 合回去', async () => {
    let ed: Editor | undefined
    const { container } = render(
      <EnHarness en={['A.', 'B.', 'C.', 'D.']} enSrc={zhFingerprint(['第一段', '第二段'])} onReady={(e) => (ed = e)} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const fourth = container.querySelectorAll('.card-en-p')[3] as HTMLTextAreaElement
    fourth.focus()
    fourth.setSelectionRange(0, 0)
    fireEvent.keyDown(fourth, { key: 'Backspace' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['A.', 'B.', 'C. D.'])
    // 合掉一段之后只剩一段是多余的
    const cells = Array.from(container.querySelectorAll('.card-en-cell'))
    expect(cells.map((c) => c.hasAttribute('data-extra'))).toEqual([false, false, true])
  })

  it('英文比中文多出来的段落带 data-extra 标记——段数不锁死，但多出来的得看得见', async () => {
    const { container } = render(
      <EnHarness en={['One.', 'Two.', 'Three.', 'Four.']} enSrc={zhFingerprint(['第一段', '第二段'])} />,
    )
    await new Promise((r) => setTimeout(r, 0))
    const cells = Array.from(container.querySelectorAll('.card-en-cell'))
    // 中文两段、英文四段：两边取大，四格全都在，后两格标成"中文没有这一段"
    expect(cells.length).toBe(4)
    expect(cells.map((c) => c.hasAttribute('data-extra'))).toEqual([false, false, true, true])
    const tas = container.querySelectorAll('.card-en-p')
    expect(tas[1].getAttribute('title')).toBeNull()
    expect(tas[2].getAttribute('title')).toBe('中文里没有对应的这一段')
  })

  it('英文段数少于中文时没有 data-extra——空格子是"还没写"，不是"多出来"', async () => {
    const { container } = render(<EnHarness en={['One.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const cells = Array.from(container.querySelectorAll('.card-en-cell'))
    expect(cells.length).toBe(2)
    expect(cells.some((c) => c.hasAttribute('data-extra'))).toBe(false)
  })

  it('打字时影子跟着变，所以格子边打边长', async () => {
    const { container } = render(<EnHarness en={['One.', 'Two.']} enSrc={zhFingerprint(['第一段', '第二段'])} />)
    await new Promise((r) => setTimeout(r, 0))
    const cell = container.querySelector('.card-en-cell') as HTMLElement
    const ta = cell.querySelector('.card-en-p') as HTMLTextAreaElement
    ta.value = 'One.\nTwo.\nThree.'
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    expect(cell.getAttribute('data-value')).toBe('One.\nTwo.\nThree.')
  })

  it('绝不给 textarea 写死内联高度——隐藏时量出来的是 0，会把格子钉成一行', async () => {
    const { container } = render(<EnHarness en={['很长的一段英文，长到必然要折行才放得下，用来确认高度不是被钉死的', 'Two.']} enSrc={'x'} />)
    await new Promise((r) => setTimeout(r, 0))
    const ta = container.querySelector('.card-en-p') as HTMLTextAreaElement
    expect(ta.style.height).toBe('')
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
            { type: 'card', attrs: { cardId: 'c0', en: null, enSrc: UNCONFIRMED },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
          ],
        },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))

    const cell = container.querySelector('.card-en-p') as HTMLTextAreaElement
    cell.value = 'The cat barred the door.'
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toEqual(['The cat barred the door.'])
    expect(attrs.enAt).not.toBe('')
    // CRITICAL：写回绝不替作者盖确认章。确认是他的动作，不是打字的副作用。
    expect(attrs.enSrc).toBe(UNCONFIRMED)
  })

  it('改自己的英文不撤销确认——作者修自己的字是在继续背书，不是推翻', async () => {
    let ed: Editor | undefined
    function Wrap() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: { type: 'doc', content: [
          { type: 'card', attrs: { cardId: 'c0', en: ['One.'], enSrc: zhFingerprint(['第一段']) },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
        ] },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))
    const cell = container.querySelector('.card-en-p') as HTMLTextAreaElement
    cell.value = 'One, revised.'
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(ed!.getJSON().content![0].attrs!.enSrc).toBe(zhFingerprint(['第一段']))
  })

  it('回车产生的是字符串里的换行，不是 DOM 节点——所以删得掉、也存得下', async () => {
    let ed: Editor | undefined
    function Wrap() {
      const editor = useEditor({
        extensions: baseExtensions,
        immediatelyRender: false,
        content: {
          type: 'doc',
          content: [
            { type: 'card', attrs: { cardId: 'c0', en: null, enSrc: UNCONFIRMED },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段' }] }] },
          ],
        },
      })
      if (editor) ed = editor
      return editor ? <EditorContent editor={editor} /> : null
    }
    const { container } = render(<Wrap />)
    await new Promise((r) => setTimeout(r, 0))

    const cell = container.querySelector('.card-en-p') as HTMLTextAreaElement
    cell.value = 'First line\nSecond line'
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    // 原来用 contentEditable 时，回车会在 DOM 里塞 <div>/<br>——那些行不在数据
    // 模型里，于是删不掉也存不下。现在它只是字符串里的一个 \n。
    expect(ed!.getJSON().content![0].attrs!.en).toEqual(['First line\nSecond line'])
    expect(container.querySelectorAll('.card-en-p br').length).toBe(0)
    expect(container.querySelectorAll('.card-en-p div').length).toBe(0)
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

    const cell = container.querySelector('.card-en-p') as HTMLTextAreaElement
    cell.value = '   '
    cell.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))

    const attrs = ed!.getJSON().content![0].attrs!
    expect(attrs.en).toBe(null)
    expect(attrs.enSrc).toBe('')
  })

})
