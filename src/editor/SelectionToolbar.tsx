import type { MouseEvent, ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEditorState, type Editor } from '@tiptap/react'
import { CARD_PALETTE, type ParagraphStyle } from './schema'
import { IconBody, IconBullet, IconChapter, IconH1, IconH2, IconNote, IconQuote } from './toolbarIcons'

// 工具栏上的每个按钮都是它自己的「样本」：段落样式画成小图（见 toolbarIcons），
// 行内标记直接拿一个「字」加上真实效果（着重号 / 「」/ 删除线）。名字只留在
// title + aria-label 里——鼠标停一下才出现，不占视觉。

// 段落层级：互斥的四档，点了就是设成它。
const HEADING_STYLES: Array<{ style: ParagraphStyle; label: string; icon: ReactNode }> = [
  { style: 'body', label: '正文', icon: <IconBody /> },
  { style: 'chapter', label: '章', icon: <IconChapter /> },
  { style: 'h1', label: '节', icon: <IconH1 /> },
  { style: 'h2', label: '二级', icon: <IconH2 /> },
]
// 块样式：点一下设上，再点一下退回正文（toggle），跟列表按钮的常见手感一致。
const BLOCK_STYLES: Array<{ style: ParagraphStyle; label: string; icon: ReactNode }> = [
  { style: 'bullet', label: '列表', icon: <IconBullet /> },
  { style: 'quote', label: '引用', icon: <IconQuote /> },
  { style: 'note', label: '注', icon: <IconNote /> },
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

  const styleButton = (
    { style, label, icon }: { style: ParagraphStyle; label: string; icon: ReactNode },
    run: () => void,
  ) => (
    <button
      key={style}
      type="button"
      className={`sel-icon${active.style === style ? ' on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active.style === style}
      onMouseDown={(e) => {
        keepSelection(e)
        run()
      }}
    >
      {icon}
    </button>
  )

  const markButton = (label: string, cls: string, on: boolean, run: () => void) => (
    <button
      type="button"
      className={`sel-mark${on ? ' on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={on}
      onMouseDown={(e) => {
        keepSelection(e)
        run()
      }}
    >
      {/* 样本字自己带上这个标记的真实效果，所以按钮就是效果预览。用「文」而不是
          「字」：「字」中间压着一道横笔画，删除线画上去会跟它糊成一笔。 */}
      <span className={cls} aria-hidden="true">
        文
      </span>
    </button>
  )

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
        {HEADING_STYLES.map((item) =>
          styleButton(item, () => editor.chain().focus().setParagraphStyle(item.style).run()),
        )}
      </div>
      <div className="sel-group">
        {BLOCK_STYLES.map((item) =>
          styleButton(item, () => editor.chain().focus().toggleParagraphStyle(item.style).run()),
        )}
      </div>
      <div className="sel-group">
        {markButton('强调', 'spec-em', active.emphasis, () => editor.chain().focus().toggleEmphasis().run())}
        {markButton('refer', 'spec-refer', active.refer, () => editor.chain().focus().toggleRefer().run())}
        {markButton('删除', 'spec-strike', active.strike, () => editor.chain().focus().toggleStrike().run())}
      </div>
      <div className="sel-group sel-colors">
        {CARD_PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            className="swatch"
            style={{ background: hex }}
            title={`卡片底色 ${hex}`}
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
          title="恢复自动配色"
          aria-label="自动/清除"
          onMouseDown={(e) => {
            keepSelection(e)
            editor.chain().focus().setCardColor(null).run()
          }}
        />
      </div>
    </BubbleMenu>
  )
}
