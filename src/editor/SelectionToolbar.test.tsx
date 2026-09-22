import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { baseExtensions, CARD_PALETTE } from './schema'
import { SelectionToolbar } from './SelectionToolbar'

function makeEditor() {
  return new Editor({
    extensions: baseExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'card',
          attrs: { cardId: 'c0' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
        },
      ],
    },
  })
}

// 选区必须在 render() 之前就设好，这样 BubbleMenu 的插件在初次注册（passive
// effect）时读到的就已经是非空选区，同步走 show()，不用等它默认的 250ms 防抖。
function selectRange(editor: Editor, from: number, to: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)))
}

function mount(editor: Editor) {
  return render(
    <>
      <EditorContent editor={editor} />
      <SelectionToolbar editor={editor} />
    </>,
  )
}

describe('SelectionToolbar', () => {
  let editor: Editor
  afterEach(() => {
    editor?.destroy()
  })

  it('点"章"调用 setParagraphStyle("chapter")，段落 style 属性随之改变', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText('章'))

    expect(editor.getJSON().content![0].content![0].attrs?.style).toBe('chapter')
  })

  it('点"正文"把已经是章的段落设回 body', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    editor.commands.setParagraphStyle('chapter')
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText('正文'))

    expect(editor.getJSON().content![0].content![0].attrs?.style).toBe('body')
  })

  it('点"强调"调用 toggleEmphasis，选中文字带上 emphasis mark', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText('强调'))

    const marks = editor.getJSON().content![0].content![0].content?.[0]?.marks ?? []
    expect(marks.map((m: any) => m.type)).toContain('emphasis')
  })

  it('点"refer"调用 toggleRefer，选中文字带上 refer mark', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText('refer'))

    const marks = editor.getJSON().content![0].content![0].content?.[0]?.marks ?? []
    expect(marks.map((m: any) => m.type)).toContain('refer')
  })

  it('点"删除"调用 toggleStrike，选中文字带上 strike mark', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText('删除'))

    const marks = editor.getJSON().content![0].content![0].content?.[0]?.marks ?? []
    expect(marks.map((m: any) => m.type)).toContain('strike')
  })

  it('"删除"按钮在选区已带 strike mark 时高亮（on class）', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    editor.commands.toggleStrike()
    mount(editor)

    expect(screen.getByLabelText('删除').className).toContain('on')
  })

  // 按钮上没有文字了（图标 / 带效果的「字」样本），名字只在 aria-label 里——
  // 所以这些用例一律按 aria-label 找按钮，顺便就是一次可访问名字的回归。
  it.each([
    ['列表', 'bullet'],
    ['引用', 'quote'],
    ['注', 'note'],
  ])('点"%s"把段落设成 %s，再点一次回到正文', (label, style) => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText(label))
    expect(editor.getJSON().content![0].content![0].attrs?.style).toBe(style)

    fireEvent.mouseDown(screen.getByLabelText(label))
    expect(editor.getJSON().content![0].content![0].attrs?.style).toBe('body')
  })

  it('当前段落样式对应的按钮是按下态（aria-pressed）', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    editor.commands.setParagraphStyle('bullet')
    mount(editor)

    expect(screen.getByLabelText('列表').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('正文').getAttribute('aria-pressed')).toBe('false')
  })

  it('点某个色块调用 setCardColor(hex)，作用于选区所在的整张卡', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText(`色块 ${CARD_PALETTE[0]}`))

    expect(editor.getJSON().content![0].attrs.color).toBe(CARD_PALETTE[0])
  })

  it('点"自动/清除"调用 setCardColor(null)', () => {
    editor = makeEditor()
    selectRange(editor, 2, 7)
    editor.commands.setCardColor(CARD_PALETTE[1])
    mount(editor)

    fireEvent.mouseDown(screen.getByLabelText('自动/清除'))

    expect(editor.getJSON().content![0].attrs.color).toBe(null)
  })
})
