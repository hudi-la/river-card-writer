import type { MouseEvent } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState, type Editor } from '@tiptap/react'
import { CARD_PALETTE, type ParagraphStyle } from './schema'

// 段落样式按钮：顺序即展示顺序。
const HEADING_STYLES: Array<{ style: ParagraphStyle; label: string }> = [
  { style: 'body', label: '正文' },
  { style: 'chapter', label: '章' },
  { style: 'h1', label: '节' },
  { style: 'h2', label: '二级' },
]
// 块样式单独一组：点一下设上，再点一下退回正文（toggle），跟列表按钮的常见手感一致。
const BLOCK_STYLES: Array<{ style: ParagraphStyle; label: string }> = [
  { style: 'bullet', label: '列表' },
  { style: 'quote', label: '引用' },
  { style: 'note', label: '注' },
]
const ALL_STYLES = [...HEADING_STYLES, ...BLOCK_STYLES]

// mousedown 上 preventDefault，别让浏览器在点按钮前先把选区收起来——
// 否则轮到 click 触发时选区已经没了，setParagraphStyle/toggleEmphasis 等
// 找不到目标段落/没有选中范围可用。
function keepSelection(e: MouseEvent) {
  e.preventDefault()
}

export function SelectionToolbar({ editor }: { editor: Editor }) {
  // 用 useEditorState 订阅编辑器事务，选区/mark 变了这里才会重渲染，
  // 按钮的高亮态才能跟手。
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      style: ALL_STYLES.find(({ style }) => editor.isActive('paragraph', { style }))?.style ?? null,
      emphasis: editor.isActive('emphasis'),
      refer: editor.isActive('refer'),
      strike: editor.isActive('strike'),
    }),
  })

  return (
    <BubbleMenu
      editor={editor}
      className="selection-toolbar"
      shouldShow={({ state }) => {
        const { selection, doc } = state
        if (selection.empty) return false
        return doc.textBetween(selection.from, selection.to, ' ').length > 0
      }}
    >
      <div className="sel-group">
        {HEADING_STYLES.map(({ style, label }) => (
          <button
            key={style}
            type="button"
            className={active.style === style ? 'on' : undefined}
            onMouseDown={(e) => {
              keepSelection(e)
              editor.chain().focus().setParagraphStyle(style).run()
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="sel-group">
        {BLOCK_STYLES.map(({ style, label }) => (
          <button
            key={style}
            type="button"
            className={active.style === style ? 'on' : undefined}
            onMouseDown={(e) => {
              keepSelection(e)
              editor.chain().focus().toggleParagraphStyle(style).run()
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="sel-group">
        <button
          type="button"
          className={active.emphasis ? 'on' : undefined}
          onMouseDown={(e) => {
            keepSelection(e)
            editor.chain().focus().toggleEmphasis().run()
          }}
        >
          强调
        </button>
        <button
          type="button"
          className={active.refer ? 'on' : undefined}
          onMouseDown={(e) => {
            keepSelection(e)
            editor.chain().focus().toggleRefer().run()
          }}
        >
          refer
        </button>
        <button
          type="button"
          className={active.strike ? 'on' : undefined}
          style={{ textDecoration: 'line-through' }}
          onMouseDown={(e) => {
            keepSelection(e)
            editor.chain().focus().toggleStrike().run()
          }}
        >
          删除
        </button>
      </div>
      <div className="sel-group sel-colors">
        {CARD_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            className="swatch"
            style={{ background: hex }}
            aria-label={`色块 ${hex}`}
            onMouseDown={(e) => {
              keepSelection(e)
              editor.chain().focus().setCardColor(hex).run()
            }}
          />
        ))}
        <button
          type="button"
          className="swatch clear"
          aria-label="自动/清除"
          onMouseDown={(e) => {
            keepSelection(e)
            editor.chain().focus().setCardColor(null).run()
          }}
        >
          清除
        </button>
      </div>
    </BubbleMenu>
  )
}
