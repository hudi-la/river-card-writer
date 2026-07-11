import { useBookStore } from '../state/bookStore'

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
