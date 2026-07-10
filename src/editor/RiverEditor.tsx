import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Node as PMNode } from '@tiptap/pm/model'
import { baseExtensions } from './schema'
import { useBookStore, EMPTY_DOC } from '../state/bookStore'
import { useEditorBridge } from '../state/editorBridge'
import { SelectionToolbar } from './SelectionToolbar'

const HANDLE_ZONE_PX = 28 // .card 左内边距 40px 里，把手落在最左侧这一段
const DRAG_MOVE_THRESHOLD_PX = 4 // 小于这个位移当作一次点击，不进入拖拽态

type DragState = {
  cardId: string
  sourceEl: HTMLElement
  ghostEl: HTMLElement
  indicatorEl: HTMLElement
  startX: number
  startY: number
  moved: boolean
  pointerId: number
}

// 拖拽进行时挂在 <html> 上的类名：CSS 借它把 user-select 关掉，防止真实鼠标在
// contenteditable 上按下之后被浏览器判定成"选字/拖字"，抢在我们自己的拖拽逻辑前面。
const DRAG_ACTIVE_CLASS = 'card-drag-active'

// 算出「放到这里」对应的 moveCardTo targetIndex：数一下光标之上、除了被拖那张卡以外
// 还有几张卡的中点在光标上方——这正好是 moveCardTo 的 splice 语义（摘掉拖拽卡之后剩下
// 那串卡里的插入下标），不需要再做额外换算。
function otherCards(dom: HTMLElement, dragCardId: string): HTMLElement[] {
  return Array.from(dom.querySelectorAll<HTMLElement>('.card')).filter((el) => el.dataset.cardId !== dragCardId)
}

function dropIndexAt(dom: HTMLElement, dragCardId: string, clientY: number): number {
  const cards = otherCards(dom, dragCardId)
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect()
    if (clientY < rect.top + rect.height / 2) return i
  }
  return cards.length
}

function indicatorRectAt(dom: HTMLElement, dragCardId: string, clientY: number): { top: number; left: number; width: number } | null {
  const cards = otherCards(dom, dragCardId)
  if (cards.length === 0) return null
  const idx = dropIndexAt(dom, dragCardId, clientY)
  if (idx <= 0) {
    const r = cards[0].getBoundingClientRect()
    return { top: r.top, left: r.left, width: r.width }
  }
  if (idx >= cards.length) {
    const r = cards[cards.length - 1].getBoundingClientRect()
    return { top: r.bottom, left: r.left, width: r.width }
  }
  const prev = cards[idx - 1].getBoundingClientRect()
  const next = cards[idx].getBoundingClientRect()
  return { top: (prev.bottom + next.top) / 2, left: next.left, width: next.width }
}

// 在（当前）doc 的顶层子节点里找 cardId 匹配的那张卡，返回它的起始 pos 与 JSON——
// 拖到盒子（park）和普通拖拽重排都要先定位这张卡。
export function findCardInDoc(doc: PMNode, cardId: string): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null
  doc.forEach((node, offset) => {
    if (!found && node.type.name === 'card' && node.attrs.cardId === cardId) {
      found = { pos: offset, node }
    }
  })
  return found
}

export function RiverEditor() {
  // 只在挂载时读一次当前书的 doc 当初始内容——之后的改动全走 onUpdate→updateDoc，
  // 不需要响应 activeBook() 变化（Workspace 用 key={activeBookId} 换书时整体重挂载）。
  const book = useBookStore((s) => s.activeBook())
  const updateDoc = useBookStore((s) => s.updateDoc)
  const carried = useBookStore((s) => s.carried)
  const getBox = useBookStore((s) => s.getBox)
  const takeCardFromBox = useBookStore((s) => s.takeCardFromBox)
  const cancelCarry = useBookStore((s) => s.cancelCarry)
  const dropCarried = useBookStore((s) => s.dropCarried)
  const parkCard = useBookStore((s) => s.parkCard)
  const dragRef = useRef<DragState | null>(null)
  const carriedRef = useRef(carried)
  carriedRef.current = carried
  const setEditor = useEditorBridge((s) => s.setEditor)

  const editor = useEditor({
    extensions: baseExtensions,
    content: book?.doc ?? EMPTY_DOC,
    immediatelyRender: false,
    onUpdate: ({ editor }) => updateDoc(editor.getJSON()),
    editorProps: { attributes: { class: 'river' } },
  })

  // 把挂载好的 editor 实例发布到 editorBridge，供左栏 sidebar 等编辑器树之外
  // 的组件调用命令（比如设置标题 note）；卸载/换书重挂载时要清空，避免陈旧引用。
  useEffect(() => {
    setEditor(editor ?? null)
    return () => setEditor(null)
  }, [editor, setEditor])

  // ⠿ 把手的真拖拽：抓住 -> 一个跟着光标走的浮动预览 + 卡之间的落点线 -> 松手落定。
  // 全部走命令式 DOM（ghost/indicator 元素直接 append 到 body），拖拽过程中每次
  // pointermove 都要更新，走 React state 重渲染代价太大也没必要。
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement

    const endDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      drag.ghostEl.remove()
      drag.indicatorEl.remove()
      drag.sourceEl.classList.remove('dragging')
      document.documentElement.classList.remove(DRAG_ACTIVE_CLASS)
      try {
        dom.releasePointerCapture(drag.pointerId)
      } catch {
        // 指针早已释放（比如浏览器在 up 之前就自己放开了 capture）时会抛，忽略即可
      }
      dragRef.current = null
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (carriedRef.current) return // 带着盒子里的卡时，落定点击优先，不进入拖拽
      const target = e.target as HTMLElement
      const card = target.closest<HTMLElement>('.card')
      if (!card) return
      const rect = card.getBoundingClientRect()
      // 把手渲染在 card 左侧 ::after（约 14px~26px 处），只在这段区域内响应
      if (e.clientX - rect.left > HANDLE_ZONE_PX) return
      const cardId = card.dataset.cardId
      if (!cardId) return
      e.preventDefault()

      const ghost = document.createElement('div')
      ghost.className = 'card-drag-ghost'
      const preview = card.querySelector('.card-body')?.textContent?.trim().slice(0, 60) || '（空卡）'
      ghost.textContent = preview
      ghost.style.display = 'none' // 只在真正越过拖拽阈值之后才现身，纯点击不会闪一下
      document.body.appendChild(ghost)

      const indicator = document.createElement('div')
      indicator.className = 'card-drop-indicator'
      indicator.style.display = 'none'
      document.body.appendChild(indicator)

      dragRef.current = {
        cardId,
        sourceEl: card,
        ghostEl: ghost,
        indicatorEl: indicator,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        pointerId: e.pointerId,
      }
      // 真实鼠标按下之后，浏览器可能在 contenteditable 上另起一套原生选区/拖拽
      // （跟我们这套命令式拖拽抢事件）——用 pointer capture 把后续 move/up 锁定
      // 到编辑器 dom 上，同时靠下面的 dragstart/selectstart 拦截 + user-select:none
      // 把原生那条路彻底堵死，不管落点在编辑器外的左栏盒子上事件是否还会自然冒泡。
      try {
        dom.setPointerCapture(e.pointerId)
      } catch {
        // 极少数环境不支持 setPointerCapture 时忽略，不影响后续 move/up 走 window 监听
      }
      document.documentElement.classList.add(DRAG_ACTIVE_CLASS)
    }

    // 命中判定/把手区间靠 pointerdown 里的 e.preventDefault()已经能挡住大多数浏览器的
    // 原生行为，但这只在 preventDefault 发生在浏览器真正决定"要不要开始选字/开始原生
    // 拖拽"之前才生效——不同引擎（尤其是 WebKit/Safari）时序不完全一致。这里再加一层
    // 兜底：只要我们自己的拖拽在进行中（dragRef.current 非空），任何原生 dragstart /
    // selectstart 一律拦截，避免它抢在 pointerup 之前把拖拽状态弄乱。
    const onDragStart = (e: DragEvent) => {
      if (dragRef.current) e.preventDefault()
    }
    const onSelectStart = (e: Event) => {
      if (dragRef.current) e.preventDefault()
    }

    const positionGhost = (ghost: HTMLElement, x: number, y: number) => {
      ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`
    }

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.moved) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.hypot(dx, dy) < DRAG_MOVE_THRESHOLD_PX) return
        drag.moved = true
        drag.ghostEl.style.display = 'block'
        drag.sourceEl.classList.add('dragging')
      }
      positionGhost(drag.ghostEl, e.clientX, e.clientY)
      const rect = indicatorRectAt(dom, drag.cardId, e.clientY)
      if (rect) {
        drag.indicatorEl.style.display = 'block'
        drag.indicatorEl.style.top = `${rect.top}px`
        drag.indicatorEl.style.left = `${rect.left}px`
        drag.indicatorEl.style.width = `${rect.width}px`
      } else {
        drag.indicatorEl.style.display = 'none'
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) {
        return
      }
      if (drag.moved) {
        // 落在左栏某个 [data-box-id] 元素上 → 收进那个盒子（park + 从正文移除），
        // 而不是重排。LeftNav（Task 4）会给盒子条目打上 data-box-id；这里防御性地
        // 直接查 document，不假设 LeftNav 具体长什么样。
        const dropEl = document.elementFromPoint(e.clientX, e.clientY)
        const boxEl = dropEl?.closest<HTMLElement>('[data-box-id]')
        const boxId = boxEl?.dataset.boxId
        if (boxId) {
          const found = findCardInDoc(editor.state.doc, drag.cardId)
          if (found) {
            const json = found.node.toJSON()
            const removed = editor.chain().focus().setTextSelection(found.pos + 2).removeCard().run()
            // removeCard 拒绝删掉文档里最后一张卡——那种情况下也不 park，避免出现
            // "卡从正文消失了但也没进盒子"的悬空态。
            if (removed) parkCard(boxId, json)
          }
        } else {
          const targetIndex = dropIndexAt(dom, drag.cardId, e.clientY)
          editor.commands.moveCardTo(drag.cardId, targetIndex)
        }
      }
      endDrag()
    }

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    // dragstart/selectstart 用 capture 阶段监听在 document 上：不管原生行为想在哪个
    // 元素上冒出来（编辑器内、甚至冒泡链更早的祖先），都能在它长成"选区"/"拖拽会话"
    // 之前拦下来。
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('selectstart', onSelectStart, true)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      endDrag()
    }
  }, [editor])

  // 装载光标：carried 非空时，点正文某张卡把它落定在那张卡之后；Esc 取消。
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const current = carriedRef.current
      if (!current) return
      const card = target.closest<HTMLElement>('.card')
      if (!card) return
      try {
        const pos = editor.view.posAtDOM(card, 0)
        const $pos = editor.state.doc.resolve(pos)
        let cardDepth = -1
        for (let d = $pos.depth; d >= 0; d--) {
          if ($pos.node(d).type.name === 'card') { cardDepth = d; break }
        }
        const cardPos = cardDepth === -1 ? pos : $pos.before(cardDepth)
        // Look up the carried card in the box at drop time — it was never
        // removed until now, so a reload mid-carry never loses it.
        const c = getBox(current.boxId)?.cards.find((x) => x.attrs.cardId === current.cardId)
        if (c) {
          editor.chain().focus().insertCardJSONAfter(c, cardPos).run()
          takeCardFromBox(current.boxId, current.cardId)
        }
        dropCarried()
      } catch {
        // 卡未挂载到编辑器 DOM 时忽略
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && carriedRef.current) cancelCarry()
    }

    dom.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      dom.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, getBox, takeCardFromBox, cancelCarry, dropCarried])

  if (!editor || !book) return null
  return (
    <div className="river-wrap">
      {carried && (
        <div className="carry-banner">
          带着一张卡——点正文某处落定 · Esc 取消
        </div>
      )}
      <EditorContent editor={editor} />
      <SelectionToolbar editor={editor} />
      <button
        className="add-card"
        onMouseDown={(e) => {
          e.preventDefault()
          editor.chain().focus().appendCard().run()
        }}
      >
        ＋ 加一张卡
      </button>
    </div>
  )
}
