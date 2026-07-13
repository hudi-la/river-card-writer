import { useEditor, EditorContent } from '@tiptap/react'
import { CornerDownRight } from 'lucide-react'
import { baseExtensions } from '../editor/schema'
import { useBookStore } from '../state/bookStore'
import { Modal } from './Modal'
import { cardText } from './BoxView'

// 把编辑器吐出来的 doc（正常只有一张 card，但 Enter/回退等操作理论上可能把它拆/
// 并成不止一张顶层 card）压平回"一张卡"：所有顶层 card 的段落按顺序拼进同一个
// content 数组，card 本身的 attrs（cardId/color/note）一律沿用打开时的原卡，不采
// 编辑器吐出来的任何一份 attrs——即便真出现拆分，也不会让第二张卡带着空/错的
// attrs 顶替掉原卡该有的颜色和 cardId（cardId 反正 store 层 updateBoxCard 还会
// 再强制核对一遍，这里是双保险）。压平后一张段落都不剩时兜底塞一个空段落，
// 保持 card 至少 paragraph+ 的 schema 下限。
export function flattenEditedCard(doc: any, originalCard: any): any {
  const topLevel = Array.isArray(doc?.content) ? doc.content : []
  const paragraphs = topLevel.flatMap((node: any) => (node?.type === 'card' && Array.isArray(node.content) ? node.content : []))
  return {
    type: 'card',
    attrs: { ...originalCard?.attrs },
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
  }
}

// 盒子卡片的展开编辑大窗（仿 Google Keep 点开一张便签）：点开时读一次这张卡的完整
// JSON 当初始内容，装一个独立的、可编辑的 TipTap 实例（同一套 baseExtensions，因此
// 排版/加粗/引用等标记跟正文编辑器完全一致）。onUpdate 每次都把编辑器当前内容压平
// 写回这张卡，经 updateBoxCard 落盘——不新增/不丢卡片，cardId 由 store 层强制保留。
//
// readOnly（书柜打开的书外通用盒子大窗）时没有"当前正文"可插入，只隐藏插入按钮；
// 编辑本身在任何地方都保持可用（数据安全 > 这一处功能限制）。
export function CardEditModal({
  boxId,
  card,
  boxName,
  onClose,
  readOnly = false,
}: {
  boxId: string
  card: any
  boxName: string
  onClose: () => void
  readOnly?: boolean
}) {
  const updateBoxCard = useBookStore((s) => s.updateBoxCard)
  const carry = useBookStore((s) => s.carry)
  const cardId: string | undefined = card?.attrs?.cardId

  // 只在挂载时读一次这张卡的内容当初始 doc（跟 RiverEditor 对 book.doc 的做法一致）——
  // 调用方（BoxView）在切换到另一张卡片时会用 key={cardId} 整体重挂载这个组件，
  // 所以这里不需要响应 card prop 后续变化。
  const editor = useEditor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [card] },
    immediatelyRender: false,
    editorProps: { attributes: { class: 'river card-edit-editor' } },
    onUpdate: ({ editor }) => {
      if (!cardId) return
      updateBoxCard(boxId, cardId, flattenEditedCard(editor.getJSON(), card))
    },
  })

  if (!cardId) return null

  const firstLine = cardText(card)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  const title = firstLine || boxName || '卡片'

  return (
    <Modal open title={title} onClose={onClose} className="modal-backdrop--card-edit">
      <div className="card-edit-body">
        <EditorContent editor={editor} />
      </div>
      <div className="card-edit-footer">
        <button type="button" className="card-edit-close" onClick={onClose}>
          关闭
        </button>
        {!readOnly && (
          <button
            type="button"
            className="card-edit-insert"
            onClick={() => {
              carry(boxId, cardId)
              onClose()
            }}
          >
            <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" /> 插入正文
          </button>
        )}
      </div>
    </Modal>
  )
}
