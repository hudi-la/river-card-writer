import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import { autoCardColor } from './schema'
import { isStale, isValidEn, zhFingerprint, ZH_JOIN } from './enText'

// 每张卡的渲染：一个 section.card（背景色 = 手动设的 color，或者按 cardId 稳定哈希
// 出的默认色）+ 中文正文 + 英文栏 + 一个纯视觉的拖拽把手（GripVertical，跟阅读陪伴
// app 同一套 Lucide 线性图标）。把手本身是 pointer-events:none（见 styles.css
// .card-drag-handle）——拖拽命中判定/真正的拖拽逻辑都在 RiverEditor 里。
//
// 英文栏（aside.card-en）始终渲染，由 .river--bilingual 这个祖先 class 决定显不显示。
// 刻意不通过 props 把"双语模式"传进 node view——那在 TipTap 里要走 editor.storage
// 或强制重建 node view，代价大且容易出 bug；一个 CSS class 就够。
//
// 卡片本身是两列 grid（见 styles.css），所以中英按卡天然对齐、只有一个滚动条，
// 不需要任何滚动同步代码。这是"英文住在中文卡片里"这个存储决定换来的红利。
export function CardView({ node, updateAttributes }: NodeViewProps) {
  const cardId: string | null = node.attrs.cardId
  const color: string | null = node.attrs.color
  const bg = color || autoCardColor(cardId ?? '')
  const style = { ['--card-bg' as any]: bg } as React.CSSProperties

  // 每段中文的文本与样式。英文不存自己的段落样式——按序号从这里继承。
  const zhTexts: string[] = []
  const zhStyles: string[] = []
  node.forEach((p) => {
    zhTexts.push(p.textContent)
    zhStyles.push(p.attrs.style || 'body')
  })

  // 脏 en（段数不符、形状不对）一律当没写过。JSON 路径不走 schema 的 parseHTML，
  // 所以这里必须再兜一层——渲染一份跟中文对不上的英文比什么都不显示更有害。
  const rawEn = node.attrs.en
  const en: string[] | null = isValidEn(rawEn, zhTexts.length) ? rawEn : null
  const stale = isStale(en, node.attrs.enSrc || '', zhTexts.join(ZH_JOIN))

  // 写回一段英文。只在 blur 时调用——写回会让这个 node view 重渲染，那时焦点
  // 已经离开，所以不会把作者正在打字的光标冲掉。
  function commit(index: number, text: string) {
    const next = en ? [...en] : zhTexts.map(() => '')
    if (next[index] === text) return
    next[index] = text
    // 全空 = 退回"没写过"，而不是存一个全是空串的数组
    const anyText = next.some((s) => s.trim() !== '')
    updateAttributes({
      en: anyText ? next : null,
      enSrc: anyText ? zhFingerprint(zhTexts) : '',
      enAt: anyText ? new Date().toISOString() : '',
    })
  }

  return (
    <NodeViewWrapper
      as="section"
      className="card"
      data-card-id={cardId || undefined}
      data-color={color || undefined}
      data-en-stale={stale ? 'true' : undefined}
      style={style}
    >
      <span className="card-drag-handle" aria-hidden="true">
        <GripVertical size={14} strokeWidth={1.75} />
      </span>
      <NodeViewContent className="card-body" />
      {/* contentEditable={false} 把英文栏从 ProseMirror 的可编辑区里摘出来，
          否则 PM 会试图把这里的输入当成文档编辑。内层每格再单独开。 */}
      <aside className="card-en" contentEditable={false}>
        {stale ? <p className="card-en-stale-note">中文改过，这段英文已过期</p> : null}
        {zhTexts.map((_, i) => (
          <div
            key={i}
            className="card-en-p"
            data-style={zhStyles[i]}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label={`第 ${i + 1} 段的英文`}
            onBlur={(e) => commit(i, e.currentTarget.textContent ?? '')}
          >
            {en ? en[i] : ''}
          </div>
        ))}
      </aside>
    </NodeViewWrapper>
  )
}
