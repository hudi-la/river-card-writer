import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { autoCardColor } from './schema'

// 每张卡的渲染就是这些：一个 section.card（背景色 = 手动设的 color，或者按
// cardId 稳定哈希出的默认色）+ 正文。⠿ 拖拽把手是纯 CSS（::after，见
// styles.css），拖拽命中判定/真正的拖拽逻辑都在 RiverEditor 里，靠 .card /
// data-card-id 这两个选择器，这里不需要再放任何交互元素。
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
      <NodeViewContent className="card-body" />
    </NodeViewWrapper>
  )
}
