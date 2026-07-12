import { useEffect } from 'react'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { Modal } from './Modal'
import { UniversalBoxControls } from './UniversalBoxControls'

// 导出给 LeftNav 复用（盒子卡片一行预览），避免两处各写一份文本抽取逻辑。
export function cardText(cardJSON: any): string {
  const paragraphs = Array.isArray(cardJSON?.content) ? cardJSON.content : []
  return paragraphs
    .map((p: any) => {
      const texts = Array.isArray(p?.content) ? p.content : []
      return texts.map((t: any) => t?.text ?? '').join('')
    })
    .join('\n')
}

// readOnly：从书柜全屏打开通用盒子时没有编辑器/正文可插入——禁用插入按钮而不是
// 让它悄悄空操作。在书内打开（无论是本书的盒子还是通用盒子）readOnly 都是
// false，插入照常走 carry。
export function BoxView({ boxId, readOnly = false }: { boxId: string | null; readOnly?: boolean }) {
  const box = useBookStore((s) => s.getBox(boxId))
  const carry = useBookStore((s) => s.carry)
  const cards = box?.cards ?? []

  return (
    <div className="box-view">
      <header className="box-header">
        <h2>{box?.name ?? ''}</h2>
        <span className="box-count">{cards.length} 张</span>
      </header>
      {cards.length === 0 ? (
        <p className="box-empty">这个盒子还是空的</p>
      ) : (
        <div className="box-grid">
          {cards.map((card, i) => {
            const cardId = card?.attrs?.cardId ?? String(i)
            return (
              <div className="tcard" key={cardId}>
                <p className="tcard-text">{cardText(card)}</p>
                <button
                  data-box-action="insert"
                  data-card-id={cardId}
                  disabled={readOnly}
                  title={readOnly ? '在书里打开通用盒子才能插入正文' : undefined}
                  onClick={() => !readOnly && boxId && carry(boxId, cardId)}
                >
                  ⤵ 插入正文
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 通用盒子的悬浮大窗（Phase 14 Task 4 #5/#6）：书内、书柜都用这同一个组件打开——
// 区别只在 readOnly（书柜没有当前 doc，插入按钮禁用）。boxId 为 null 时不渲染
// （Modal 的 open 由此推出），调用方不需要自己再判一次。
//
// 默认那个通用盒子（id===UNIVERSAL_BOX_ID）额外带上它自己独立的 JSON 导出/导入
// 控件（UniversalBoxControls）——这是 Phase 11 就有的老功能，import 走的 store
// action 语义上只认这一个默认盒子（见 UniversalBoxControls 顶部注释），新建的
// 具名通用盒子没有这个入口，走全库备份即可覆盖到它们。
export function UniversalBoxModal({
  boxId,
  onClose,
  readOnly = false,
}: {
  boxId: string | null
  onClose: () => void
  readOnly?: boolean
}) {
  const box = useBookStore((s) => (boxId ? s.getBox(boxId) : undefined))
  const carried = useBookStore((s) => s.carried)

  // 点"⤵ 插入正文"之后（carry() 把卡"带在手上"、切到正文视图等着落点），窗必须
  // 自己关掉——不然 Modal 的遮罩挡住整个正文，用户点不到任何地方落定这张卡。
  // readOnly 时插入按钮本来就是禁用的，不会触发 carried，这个 effect 天然不会
  // 在书柜那个只读大窗上误触发。
  useEffect(() => {
    if (boxId !== null && carried) onClose()
  }, [carried, boxId, onClose])

  return (
    <Modal open={boxId !== null} title={box?.name ?? ''} onClose={onClose}>
      {boxId === UNIVERSAL_BOX_ID && <UniversalBoxControls />}
      <BoxView boxId={boxId} readOnly={readOnly} />
    </Modal>
  )
}
