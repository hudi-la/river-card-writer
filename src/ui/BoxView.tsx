import { useEffect, useRef, useState, type RefObject } from 'react'
import { GripVertical, CornerDownRight } from 'lucide-react'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { Modal } from './Modal'
import { UniversalBoxControls } from './UniversalBoxControls'
import { CardEditModal } from './CardEditModal'

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

// ---- 盒子卡片（.tcard）拖动：盒内重排 + 拖去另一个盒子（主要是通用盒子）----
// 跟 RiverEditor 的 ⠿ 把手拖拽同一套命令式骨架（专用把手起拖、ref 存拖拽态、
// 固定定位 ghost + 落点指示、pointerup/pointercancel/lostpointercapture 三路
// 幂等收尾）；落点判定分两路：
//   1. 指针悬停在左栏（.rail）某个 [data-box-id] 行上、且不是当前这个盒子——
//      当作"搬去另一个盒子"，高亮该行（复用 RiverEditor 同一个 DROP_TARGET_CLASS/
//      .chap.drop-target 样式），松手调 moveCardToBox。
//   2. 否则——当作"盒内重排"，在 .box-grid（网格，非单列）里找指针当前悬停/最近的
//      那张卡，按落在它左半/右半决定插到它之前/之后，松手调 moveCardInBox。
const TCARD_DRAG_MOVE_THRESHOLD_PX = 4
const TCARD_DRAG_ACTIVE_CLASS = 'tcard-drag-active'
const DROP_TARGET_CLASS = 'drop-target' // 跟 RiverEditor.tsx 里同名常量保持同一个 class，样式定义共用一份 CSS

type TcardDragState = {
  cardId: string
  fromBoxId: string
  sourceEl: HTMLElement
  ghostEl: HTMLElement
  indicatorEl: HTMLElement
  startX: number
  startY: number
  moved: boolean
  pointerId: number
  targetBoxId: string | null
  targetBoxEl: HTMLElement | null
  pendingReorderIndex: number | null
}

function otherTcards(container: HTMLElement, dragCardId: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.tcard')).filter((el) => el.dataset.cardId !== dragCardId)
}

// 网格版落点判定：.box-grid 是多列网格，不是单列列表，RiverEditor/大纲那套"数
// 中点"落点线在跨行时会失真。改成"指针当前底下（或没压中卡片时，欧氏距离最近）
// 的那张卡"，再看指针落在它左半还是右半决定插到它之前/之后。others 数组本身就是
// "摘掉被拖卡之后剩下那串"，数组下标直接是 moveCardInBox 要的 splice 下标。
function tcardDropAt(
  container: HTMLElement,
  dragCardId: string,
  clientX: number,
  clientY: number,
): { targetIndex: number; rect: { top: number; left: number; height: number } | null } {
  const others = otherTcards(container, dragCardId)
  if (others.length === 0) return { targetIndex: 0, rect: null }

  let hovered = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.tcard') ?? null
  if (hovered && (hovered.dataset.cardId === dragCardId || !others.includes(hovered))) hovered = null

  if (!hovered) {
    let bestDist = Infinity
    for (const el of others) {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const d = Math.hypot(cx - clientX, cy - clientY)
      if (d < bestDist) {
        bestDist = d
        hovered = el
      }
    }
  }
  if (!hovered) return { targetIndex: others.length, rect: null }

  const idx = others.indexOf(hovered)
  const rect = hovered.getBoundingClientRect()
  const before = clientX < rect.left + rect.width / 2
  const targetIndex = before ? idx : idx + 1
  return { targetIndex, rect: { top: rect.top, left: before ? rect.left : rect.right, height: rect.height } }
}

function useTcardDrag({
  gridRef,
  boxId,
  moveCardInBox,
  moveCardToBox,
}: {
  gridRef: RefObject<HTMLElement | null>
  boxId: string | null
  moveCardInBox: (boxId: string, cardId: string, targetIndex?: number) => void
  moveCardToBox: (fromBoxId: string, cardId: string, toBoxId: string, targetIndex?: number) => void
}) {
  const dragRef = useRef<TcardDragState | null>(null)
  const boxIdRef = useRef(boxId)
  boxIdRef.current = boxId
  // 真拖拽（越过移动阈值）松手之后，浏览器有时仍会在原释放点合成一个 click 事件
  // （尤其是 pointerup 落在拖拽起点那张卡自己身上时）——这个标记让紧跟在一次真拖拽
  // 后面的第一个 click 被吞掉，避免"拖一下卡片"意外被当成"点开卡片编辑大窗"。
  // 没发生真拖拽（纯点击/点了把手但没移动）时这个标记始终是 false，不影响正常点击。
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const gridEl = gridRef.current
    if (!gridEl || !boxId) return

    const cleanupVisuals = (drag: TcardDragState) => {
      drag.ghostEl.remove()
      drag.indicatorEl.remove()
      drag.sourceEl.classList.remove('tcard-dragging')
      drag.targetBoxEl?.classList.remove(DROP_TARGET_CLASS)
      document.documentElement.classList.remove(TCARD_DRAG_ACTIVE_CLASS)
      try {
        gridEl.releasePointerCapture(drag.pointerId)
      } catch {
        // 指针早已释放时会抛，忽略即可
      }
    }

    const finishDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (drag.moved) {
        suppressClickRef.current = true
        if (drag.targetBoxId && drag.targetBoxId !== drag.fromBoxId) {
          moveCardToBox(drag.fromBoxId, drag.cardId, drag.targetBoxId)
        } else if (drag.pendingReorderIndex !== null) {
          moveCardInBox(drag.fromBoxId, drag.cardId, drag.pendingReorderIndex)
        }
      }
      cleanupVisuals(drag)
    }

    // 见上面 suppressClickRef 的注释：吞掉真拖拽之后紧跟着的第一个 click，且只吞
    // 这一次——不管它落在哪张卡上。用 capture 阶段拦截，确保比 .tcard 自己的
    // onClick（React 走 bubble 阶段）先执行。
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickRef.current) return
      suppressClickRef.current = false
      e.stopPropagation()
    }

    const abortDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      cleanupVisuals(drag)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      const handle = target.closest<HTMLElement>('[data-tcard-drag-handle]')
      if (!handle) return
      const card = handle.closest<HTMLElement>('.tcard')
      const cardId = card?.dataset.cardId
      if (!card || !cardId) return
      e.preventDefault()

      const ghost = document.createElement('div')
      ghost.className = 'card-drag-ghost'
      ghost.textContent = card.querySelector('.tcard-text')?.textContent?.trim().slice(0, 60) || '（空卡）'
      ghost.style.display = 'none'
      document.body.appendChild(ghost)

      const indicator = document.createElement('div')
      indicator.className = 'tcard-drop-indicator'
      indicator.style.display = 'none'
      document.body.appendChild(indicator)

      dragRef.current = {
        cardId,
        fromBoxId: boxIdRef.current!,
        sourceEl: card,
        ghostEl: ghost,
        indicatorEl: indicator,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
        targetBoxId: null,
        targetBoxEl: null,
        pendingReorderIndex: null,
      }
      try {
        gridEl.setPointerCapture(e.pointerId)
      } catch {
        // 极少数环境不支持 setPointerCapture，忽略即可
      }
      document.documentElement.classList.add(TCARD_DRAG_ACTIVE_CLASS)
    }

    const onDragStart = (e: DragEvent) => {
      if (dragRef.current) e.preventDefault()
    }
    const onSelectStart = (e: Event) => {
      if (dragRef.current) e.preventDefault()
    }

    const setDropTarget = (drag: TcardDragState, boxEl: HTMLElement | null) => {
      const targetId = boxEl?.dataset.boxId ?? null
      if (drag.targetBoxId === targetId) return
      drag.targetBoxEl?.classList.remove(DROP_TARGET_CLASS)
      drag.targetBoxId = targetId
      drag.targetBoxEl = boxEl
      boxEl?.classList.add(DROP_TARGET_CLASS)
    }

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.moved) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.hypot(dx, dy) < TCARD_DRAG_MOVE_THRESHOLD_PX) return
        drag.moved = true
        drag.ghostEl.style.display = 'block'
        drag.sourceEl.classList.add('tcard-dragging')
      }
      drag.ghostEl.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`

      // 悬停判定：先看指针是不是压在左栏（.rail）某个盒子行上——那是"搬去另一个
      // 盒子"的落点；命中自己当前这个盒子不算（拖出去又落回原盒子的行为交给下面
      // 的盒内重排分支处理，不当成跨盒搬家）。
      const elAt = document.elementFromPoint(e.clientX, e.clientY)
      const boxEl = elAt?.closest<HTMLElement>('[data-box-id]') ?? null
      const overRailBox = boxEl && !!boxEl.closest('.rail') && boxEl.dataset.boxId !== drag.fromBoxId

      if (overRailBox) {
        setDropTarget(drag, boxEl)
        drag.pendingReorderIndex = null
        drag.indicatorEl.style.display = 'none'
        return
      }

      setDropTarget(drag, null)
      const { targetIndex, rect } = tcardDropAt(gridEl, drag.cardId, e.clientX, e.clientY)
      drag.pendingReorderIndex = targetIndex
      if (rect) {
        drag.indicatorEl.style.display = 'block'
        drag.indicatorEl.style.top = `${rect.top}px`
        drag.indicatorEl.style.left = `${rect.left}px`
        drag.indicatorEl.style.height = `${rect.height}px`
      } else {
        drag.indicatorEl.style.display = 'none'
      }
    }

    gridEl.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    gridEl.addEventListener('pointerup', finishDrag)
    gridEl.addEventListener('pointercancel', finishDrag)
    gridEl.addEventListener('lostpointercapture', finishDrag)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('lostpointercapture', finishDrag)
    gridEl.addEventListener('click', onClickCapture, true)
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('selectstart', onSelectStart, true)
    return () => {
      gridEl.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      gridEl.removeEventListener('pointerup', finishDrag)
      gridEl.removeEventListener('pointercancel', finishDrag)
      gridEl.removeEventListener('lostpointercapture', finishDrag)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('lostpointercapture', finishDrag)
      gridEl.removeEventListener('click', onClickCapture, true)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      abortDrag()
    }
  }, [gridRef, boxId, moveCardInBox, moveCardToBox])
}

// readOnly：从书柜全屏打开通用盒子时没有编辑器/正文可插入——禁用插入按钮而不是
// 让它悄悄空操作。在书内打开（无论是本书的盒子还是通用盒子）readOnly 都是
// false，插入照常走 carry。拖拽重排/搬盒子不依赖编辑器，readOnly 时同样可用。
export function BoxView({ boxId, readOnly = false }: { boxId: string | null; readOnly?: boolean }) {
  const box = useBookStore((s) => s.getBox(boxId))
  const carry = useBookStore((s) => s.carry)
  const moveCardInBox = useBookStore((s) => s.moveCardInBox)
  const moveCardToBox = useBookStore((s) => s.moveCardToBox)
  const cards = box?.cards ?? []
  const gridRef = useRef<HTMLDivElement | null>(null)
  useTcardDrag({ gridRef, boxId, moveCardInBox, moveCardToBox })

  // 点开某张卡的展开编辑大窗（仿 Google Keep）。只存 cardId，内容每次从 cards 里
  // 现取——这样 store 落盘之后 editingCard 也跟着刷新，不会拿着一份过期的引用。
  // 切换 boxId（比如换了一个不同的盒子）时清掉，避免带着上一个盒子的 cardId
  // 误开一张不相关的卡。
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  useEffect(() => {
    setEditingCardId(null)
  }, [boxId])
  const editingCard = editingCardId ? cards.find((c) => c?.attrs?.cardId === editingCardId) : undefined

  // 点卡片正文打开编辑大窗——但点在拖拽把手或"插入正文"按钮上时不算（那两个
  // 各自有自己的行为：拖排序/移盒子、直接插入正文），用 closest 排除掉，不管
  // 点击落在图标本身还是按钮内的文字上都能排除干净。
  const onCardClick = (e: React.MouseEvent<HTMLDivElement>, cardId: string) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-tcard-drag-handle]')) return
    if (target.closest('[data-box-action]')) return
    setEditingCardId(cardId)
  }

  return (
    <div className="box-view">
      <header className="box-header">
        <h2>{box?.name ?? ''}</h2>
        <span className="box-count">{cards.length} 张</span>
      </header>
      {cards.length === 0 ? (
        <p className="box-empty">这个盒子还是空的</p>
      ) : (
        <div className="box-grid" ref={gridRef}>
          {cards.map((card, i) => {
            const cardId = card?.attrs?.cardId ?? String(i)
            return (
              <div
                className="tcard"
                key={cardId}
                data-card-id={cardId}
                onClick={(e) => onCardClick(e, cardId)}
              >
                <span className="tcard-drag-handle" data-tcard-drag-handle aria-hidden="true" title="拖动排序/移到另一个盒子">
                  <GripVertical size={14} strokeWidth={1.75} />
                </span>
                <p className="tcard-text">{cardText(card)}</p>
                <button
                  data-box-action="insert"
                  data-card-id={cardId}
                  disabled={readOnly}
                  title={readOnly ? '在书里打开通用盒子才能插入正文' : undefined}
                  onClick={() => !readOnly && boxId && carry(boxId, cardId)}
                >
                  <CornerDownRight size={13} strokeWidth={1.75} aria-hidden="true" /> 插入正文
                </button>
              </div>
            )
          })}
        </div>
      )}
      {boxId && editingCardId && editingCard && (
        <CardEditModal
          key={editingCardId}
          boxId={boxId}
          card={editingCard}
          boxName={box?.name ?? ''}
          onClose={() => setEditingCardId(null)}
          readOnly={readOnly}
        />
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
