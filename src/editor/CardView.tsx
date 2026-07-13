import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import { autoCardColor } from './schema'

// 每张卡的渲染就是这些：一个 section.card（背景色 = 手动设的 color，或者按
// cardId 稳定哈希出的默认色）+ 正文 + 一个纯视觉的拖拽把手（GripVertical，跟
// 阅读陪伴 app 同一套 Lucide 线性图标）。把手本身是 pointer-events:none（见
// styles.css .card-drag-handle）——拖拽命中判定/真正的拖拽逻辑都在
// RiverEditor 里，只按指针相对 .card 左边缘的像素区间判定（HANDLE_ZONE_PX），
// 不关心事件具体落在把手图标还是正文上，这个把手只是告诉用户"这一片能拖"。
export function CardView({ node }: NodeViewProps) {
  const cardId: string | null = node.attrs.cardId
  const color: string | null = node.attrs.color
  const bg = color || autoCardColor(cardId ?? '')
  const style = { ['--card-bg' as any]: bg } as React.CSSProperties

  return (
    <NodeViewWrapper
      as="section"
      className="card"
      data-card-id={cardId || undefined}
      data-color={color || undefined}
      style={style}
    >
      <span className="card-drag-handle" aria-hidden="true">
        <GripVertical size={14} strokeWidth={1.75} />
      </span>
      <NodeViewContent className="card-body" />
    </NodeViewWrapper>
  )
}
