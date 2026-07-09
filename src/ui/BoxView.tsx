import { useBookStore } from '../state/bookStore'

function cardText(cardJSON: any): string {
  const paragraphs = Array.isArray(cardJSON?.content) ? cardJSON.content : []
  return paragraphs
    .map((p: any) => {
      const texts = Array.isArray(p?.content) ? p.content : []
      return texts.map((t: any) => t?.text ?? '').join('')
    })
    .join('\n')
}

export function BoxView({ boxId }: { boxId: string | null }) {
  const box = useBookStore((s) => s.getBox(boxId))
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
                  onClick={() => console.log('insert placeholder', cardId)}
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
