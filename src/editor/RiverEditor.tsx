import { useEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import { baseExtensions, findCardInDoc } from './schema'
import { ActiveCard, PrepHighlight, PREP_HIGHLIGHT_REFRESH } from './prepHighlight'
import { usePrepBridge } from '../state/prepBridge'
import { useBookStore, EMPTY_DOC } from '../state/bookStore'
import { useEditorBridge } from '../state/editorBridge'
import { SelectionToolbar } from './SelectionToolbar'

const HEADING_STYLES = ['chapter', 'h1', 'h2']
function cardPreviewText(card: any): string {
  const out: string[] = []
  const walk = (n: any) => {
    if (n?.type === 'text' && n.text) out.push(n.text)
    ;(n?.content || []).forEach(walk)
  }
  ;(card?.content || []).forEach(walk)
  return out.join('').trim()
}
// 从 doc + cardId 解析出这张卡在大纲意义上的信息（kind/note/预览 + note 保存所需的序号），
// 跟 outlineTreeFromDoc / setHeadingNote / setCardNote 的编号规则一致，但不 import LeftNav（避免 editor↔ui 环）。
export function resolveCardRow(doc: any, cardId: string) {
  const cards = doc?.content || []
  const cardIndex = cards.findIndex((c: any) => c?.attrs?.cardId === cardId)
  if (cardIndex < 0) return null
  const card = cards[cardIndex]
  const headingPara = (card?.content || []).find((p: any) => HEADING_STYLES.includes(p?.attrs?.style))
  if (headingPara) {
    let headingIndex = -1
    for (let i = 0; i <= cardIndex; i++) {
      if ((cards[i]?.content || []).some((p: any) => HEADING_STYLES.includes(p?.attrs?.style))) headingIndex++
    }
    return { kind: 'heading' as const, cardIndex, headingIndex, note: headingPara.attrs?.note || '', preview: cardPreviewText(card) || '（无标题）' }
  }
  return { kind: 'block' as const, cardIndex, headingIndex: -1, note: card?.attrs?.note || '', preview: cardPreviewText(card) || '（空卡）' }
}

// 点正文卡片左侧的拖动把手（没拖动、纯点击）时弹出的小框：上面一行卡片预览，下面写「说明」。
// 说明按跟目录同一条路保存——标题卡走 setHeadingNote，普通卡走 setCardNote，两处看到的是同一份 note。
function CardNotePopover({ cardId, x, y, onClose }: { cardId: string; x: number; y: number; onClose: () => void }) {
  const setCardNote = useEditorBridge((s) => s.setCardNote)
  const setHeadingNote = useEditorBridge((s) => s.setHeadingNote)
  const doc = useBookStore((s) => s.activeBook()?.doc)
  const info = useMemo(() => resolveCardRow(doc, cardId), [doc, cardId])
  const [draft, setDraft] = useState(info?.note || '')
  const ref = useRef<HTMLDivElement>(null)
  const infoRef = useRef(info)
  infoRef.current = info
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    const save = () => {
      const it = infoRef.current
      if (!it) return
      if (it.kind === 'heading') setHeadingNote(it.headingIndex, draftRef.current)
      else setCardNote(it.cardIndex, draftRef.current)
    }
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        save()
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        save()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, setCardNote, setHeadingNote])

  if (!info) return null
  const left = Math.max(8, Math.min(x + 24, window.innerWidth - 296))
  const top = Math.max(8, Math.min(y, window.innerHeight - 170))
  return createPortal(
    <div className="card-note-pop" ref={ref} style={{ left, top }}>
      <div className="card-note-pop-preview">{info.preview}</div>
      <textarea
        className="card-note-pop-note"
        value={draft}
        placeholder="写点说明…"
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>,
    document.body,
  )
}

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
  // 悬停在哪个盒子条目上——在 pointermove 里持续更新，收尾时直接读它，不再
  // 现场重新 elementFromPoint（见下面 onPointerMove/finishDrag 里的注释）。
  targetBoxId: string | null
  targetBoxEl: HTMLElement | null
  // 同理，重排分支要用的落点坐标也在 pointermove 里持续记录，收尾时不读
  // 触发收尾那个事件自己的坐标——pointercancel/lostpointercapture 不保证带着
  // 有意义的坐标，且就算是 pointerup，最后一帧也可能因为指针抖动跟前一帧的
  // 悬停判定对不上。lastX 还兼作 finishDrag 里 targetBoxId 丢失时的兜底
  // 重新探测坐标（见 finishDrag 注释）。
  lastX: number
  lastY: number
}

// 盒子悬停高亮的类名——导出给大纲块行拖拽（LeftNav.tsx 的 useOutlineRowDrag）
// 复用，两条拖拽路径（正文卡片拖到盒子 / 大纲块行拖到盒子）共用同一份视觉反馈，
// 不各自定义一份容易漂移的同名 class 字符串。
export const DROP_TARGET_CLASS = 'drop-target'

// 左栏/侧栏容器的选择器——LeftNav 渲染的 <nav className="rail">，盒子条目（[data-box-id]）
// 都是它的子元素。sticky 悬停判定（见 onPointerMove）用它来区分"指针只是从盒子行边缘
// 滑出去了一点点，但还在栏内"和"指针真的移到正文/河流区域了，用户想重排"。
const RAIL_SELECTOR = '.rail'

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

// findCardInDoc 现在定义在 schema.ts（editorBridge.ts 也要用它，放在 schema.ts
// 里避免跟这个文件产生循环 import）——这里 re-export 一份，保持既有调用方/
// 测试（`import { findCardInDoc } from './RiverEditor'`）不用改。
export { findCardInDoc }

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

  // 点把手（没拖动）时弹出的"预览+说明"小框。openNoteRef 让命令式的 finishDrag（在
  // useEffect 闭包里）能触发 React 侧的 setState——每次渲染刷新一次，读到的永远是最新 setter。
  const [notePop, setNotePop] = useState<{ cardId: string; x: number; y: number } | null>(null)
  const openNoteRef = useRef<(el: HTMLElement) => void>(() => {})
  openNoteRef.current = (cardEl) => {
    const r = cardEl.getBoundingClientRect()
    setNotePop({ cardId: cardEl.dataset.cardId || '', x: r.left, y: r.top })
  }

  const editor = useEditor({
    // 靶心高亮：从 store 现读这本书的 hints，不作为依赖传进来——扩展只在创建时
    // 配一次，getTerms 每次调用都取最新状态，所以 hints 变了不用重建编辑器。
    extensions: [
      ...baseExtensions,
      ActiveCard,
      PrepHighlight.configure({
        getTerms: (cardId) => {
          const book = useBookStore.getState().activeBook()
          // 「给译文」档不看词卡，正文里的靶心高亮也跟着收起
          if (book?.aiPolicy === 'auto') return []
          const hints = book?.hints?.[cardId]
          return hints ? hints.targets.map((t) => t.zh) : []
        },
      }),
    ],
    content: book?.doc ?? EMPTY_DOC,
    immediatelyRender: false,
    onUpdate: ({ editor }) => updateDoc(editor.getJSON()),
    editorProps: { attributes: { class: 'river', role: 'textbox', 'aria-label': '正文编辑器', 'aria-multiline': 'true' } },
  })

  // 把挂载好的 editor 实例发布到 editorBridge，供左栏 sidebar 等编辑器树之外
  // 的组件调用命令（比如设置标题 note）；卸载/换书重挂载时要清空，避免陈旧引用。
  useEffect(() => {
    setEditor(editor ?? null)
    return () => setEditor(null)
  }, [editor, setEditor])

  // 鼠标划过正文里的靶心词时，告诉备料边栏是哪一个——它会滚过去并点亮。
  // 用事件委托挂在编辑器根上：装饰器是 ProseMirror 画的，React 碰不到那些
  // 节点，没法给它们挂 onMouseEnter。
  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    const setHovered = usePrepBridge.getState().setHoveredTerm
    const onOver = (e: Event) => {
      const hit = (e.target as HTMLElement | null)?.closest?.('.prep-hit') as HTMLElement | null
      if (hit) setHovered(hit.dataset.prepTerm ?? null)
    }
    const onOut = (e: Event) => {
      const hit = (e.target as HTMLElement | null)?.closest?.('.prep-hit')
      if (hit) setHovered(null)
    }
    root.addEventListener('mouseover', onOver)
    root.addEventListener('mouseout', onOut)
    return () => {
      root.removeEventListener('mouseover', onOver)
      root.removeEventListener('mouseout', onOut)
      setHovered(null)
    }
  }, [editor])

  // 提词变了但文档没变时，ProseMirror 不会自己重算装饰器（它只在 doc 变化时重跑）。
  // 订阅 hints 的引用变化，发一个空事务带 refresh meta 逼它重算一次——备料边跑边
  // 出结果，高亮就跟着一张张亮起来。换档也一样：高亮跟着档位亮或灭。
  useEffect(() => {
    if (!editor) return
    let prev = useBookStore.getState().activeBook()?.hints
    let prevPolicy = useBookStore.getState().activeBook()?.aiPolicy
    return useBookStore.subscribe((state) => {
      const next = state.activeBook()?.hints
      const nextPolicy = state.activeBook()?.aiPolicy
      if (next === prev && nextPolicy === prevPolicy) return
      prev = next
      prevPolicy = nextPolicy
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(PREP_HIGHLIGHT_REFRESH, true))
    })
  }, [editor])

  // ⠿ 把手的真拖拽：抓住 -> 一个跟着光标走的浮动预览 + 卡之间的落点线 -> 松手落定。
  // 全部走命令式 DOM（ghost/indicator 元素直接 append 到 body），拖拽过程中每次
  // pointermove 都要更新，走 React state 重渲染代价太大也没必要。
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement

    // 纯 DOM/视觉层面的收尾——ghost、落点线、高亮、user-select 类、指针 capture
    // 全部还原。不碰 dragRef，调用方负责先把 dragRef.current 置空。
    const cleanupDragVisuals = (drag: DragState) => {
      drag.ghostEl.remove()
      drag.indicatorEl.remove()
      drag.sourceEl.classList.remove('dragging')
      drag.targetBoxEl?.classList.remove(DROP_TARGET_CLASS)
      document.documentElement.classList.remove(DRAG_ACTIVE_CLASS)
      try {
        dom.releasePointerCapture(drag.pointerId)
      } catch {
        // 指针早已释放（比如浏览器在 up 之前就自己放开了 capture）时会抛，忽略即可
      }
    }

    // 真正"落地"的收尾：读 move 阶段跟踪好的 targetBoxId/lastY 做落定判定
    // （park 或重排），然后做视觉清理。dragRef 立刻置空是关键的幂等闸门——
    // pointerup/pointercancel/lostpointercapture 三个事件都可能触发这里
    // （见下面的监听器注册），不管 WebKit 下 pointer capture 把哪一个事件
    // 送到 window、哪一个只送到被 capture 的编辑器 DOM 上，第一个先到的
    // 跑完全部逻辑，其余的直接因为 dragRef.current 已经是 null 而提前返回。
    const finishDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      if (drag.moved) {
        // 正常情况下 targetBoxId 在 pointermove 里已经跟踪好了（含下面的 sticky
        // 悬停判定）。这里再加一道兜底：万一它出于某种原因始终是 null（比如拖拽
        // 极短、还没来得及跑一次有意义的 pointermove 就直接收尾），用最后一次记录
        // 的指针坐标现查一次，而不是直接判定为「用户想重排」——这是 park 判定的
        // 最后一道保险，不是主路径。
        const boxId = drag.targetBoxId ?? boxElAt(drag.lastX, drag.lastY)?.dataset.boxId ?? null
        if (boxId) {
          const found = findCardInDoc(editor.state.doc, drag.cardId)
          if (found) {
            const json = found.node.toJSON()
            if (editor.state.doc.childCount > 1) {
              const removed = editor.chain().focus().setTextSelection(found.pos + 2).removeCard().run()
              if (removed) parkCard(boxId, json)
            } else {
              // 只剩这一张卡时 removeCard 会拒删（文档不能空）。先把内容安全存进盒子
              // （先落袋、不丢），再追加一张空卡让文档 >1，然后删掉原卡——内容进了盒子、
              // 文档留下一张空卡不悬空。用的都是会触发 onUpdate 保存的命令。
              parkCard(boxId, json)
              editor.commands.appendCard()
              const again = findCardInDoc(editor.state.doc, drag.cardId)
              if (again) editor.chain().focus().setTextSelection(again.pos + 2).removeCard().run()
            }
          }
        } else {
          const targetIndex = dropIndexAt(dom, drag.cardId, drag.lastY)
          editor.commands.moveCardTo(drag.cardId, targetIndex)
        }
      } else {
        // 纯点击把手（没超过拖拽阈值）→ 弹出这张卡的"预览 + 说明"小框
        openNoteRef.current(drag.sourceEl)
      }
      cleanupDragVisuals(drag)
    }

    // 卸载时中途放弃一场还没走完的拖拽——只清理视觉，不触发落定（跟真正松手
    // 完成拖拽是两回事）。
    const abortDrag = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      cleanupDragVisuals(drag)
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
        targetBoxId: null,
        targetBoxEl: null,
        lastX: e.clientX,
        lastY: e.clientY,
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

    // 拖拽 ghost/indicator 都是 pointer-events:none（见 CSS），不会挡住
    // elementFromPoint——不需要现场隐藏它们再探测。
    const boxElAt = (x: number, y: number): HTMLElement | null =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-box-id]') ?? null

    const setDropTarget = (drag: DragState, boxEl: HTMLElement | null) => {
      const boxId = boxEl?.dataset.boxId ?? null
      if (drag.targetBoxId === boxId) return
      drag.targetBoxEl?.classList.remove(DROP_TARGET_CLASS)
      drag.targetBoxId = boxId
      drag.targetBoxEl = boxEl
      boxEl?.classList.add(DROP_TARGET_CLASS)
    }

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      if (!drag.moved) {
        const dx = e.clientX - drag.startX
        const dy = e.clientY - drag.startY
        if (Math.hypot(dx, dy) < DRAG_MOVE_THRESHOLD_PX) return
        drag.moved = true
        drag.ghostEl.style.display = 'block'
        drag.sourceEl.classList.add('dragging')
      }
      positionGhost(drag.ghostEl, e.clientX, e.clientY)

      // 悬停判定放在 move 里做，而不是只在 pointerup 那一帧才查——这样才能在悬停
      // 期间给盒子条目高亮反馈，且 pointerup 时不必再赌那最后一帧的坐标是否精确
      // 落在小小的盒子行上（真实鼠标松手前最后一次 move 和 up 的坐标可能有几像素
      // 出入，之前就是靠这一帧现查，稍微偏一点就掉回「重排」分支，卡没进盒子却也
      // 没有任何提示）。
      const elAt = document.elementFromPoint(e.clientX, e.clientY)
      const boxEl = elAt?.closest<HTMLElement>('[data-box-id]') ?? null

      if (boxEl) {
        setDropTarget(drag, boxEl)
        // 悬停在盒子上时，重排落点线没有意义（不会重排），隐藏掉避免视觉打架。
        drag.indicatorEl.style.display = 'none'
        return
      }

      // 这一帧指针底下没有盒子行。盒子行又矮又挨在一起（.chap 之间没有间距），
      // 真实的手在松手前最后一次移动，很容易落在刚刚悬停的那一行外面几像素——
      // 落到相邻的非盒子行（比如"+ 新盒子"）上，或栏自身的内边距里，但仍然
      // 明显还在左栏/侧栏（.rail）范围内，并不是往正文挪。这种情况下继续沿用
      // 之前跟踪好的目标和高亮（sticky），不要清掉——只有指针确实离开了 .rail、
      // 落到正文（河流）区域，才当作"用户想重排，放弃 park"来处理。
      const overRail = !!elAt?.closest(RAIL_SELECTOR)
      if (overRail) {
        drag.indicatorEl.style.display = 'none'
        return
      }

      setDropTarget(drag, null)
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

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    // 收尾监听器同时挂在 window 和被 setPointerCapture 锁定的编辑器 dom 上，
    // 且监听 pointerup/pointercancel/lostpointercapture 三种事件——这是这次
    // 修复的核心。背景：pointerdown 里给 dom 做了 setPointerCapture，Chromium
    // 下 pointerup 之后依然照常冒泡到 window，只挂 window 监听就够用；但
    // WebKit/Safari 在指针被 capture 之后，有版本会把 pointerup 完全重定向到
    // capture 元素而不再冒泡到 window（真机上表现为：拖拽悬停高亮正常——那是
    // pointermove 走的——但松手后卡既不进盒子也不重排，因为 window 上的
    // pointerup 压根没收到事件）。直接把同一套收尾逻辑也挂到 dom 自己身上，
    // 不管事件最终冒到哪层都能兜住；finishDrag 内部用 dragRef 置空做幂等闸门，
    // 同一次拖拽被多个监听器/多个事件重复触发时只有第一次真正执行。
    dom.addEventListener('pointerup', finishDrag)
    dom.addEventListener('pointercancel', finishDrag)
    dom.addEventListener('lostpointercapture', finishDrag)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('lostpointercapture', finishDrag)
    // dragstart/selectstart 用 capture 阶段监听在 document 上：不管原生行为想在哪个
    // 元素上冒出来（编辑器内、甚至冒泡链更早的祖先），都能在它长成"选区"/"拖拽会话"
    // 之前拦下来。
    document.addEventListener('dragstart', onDragStart, true)
    document.addEventListener('selectstart', onSelectStart, true)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', finishDrag)
      dom.removeEventListener('pointercancel', finishDrag)
      dom.removeEventListener('lostpointercapture', finishDrag)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('lostpointercapture', finishDrag)
      document.removeEventListener('dragstart', onDragStart, true)
      document.removeEventListener('selectstart', onSelectStart, true)
      abortDrag()
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
      {notePop && (
        <CardNotePopover
          key={notePop.cardId}
          cardId={notePop.cardId}
          x={notePop.x}
          y={notePop.y}
          onClose={() => setNotePop(null)}
        />
      )}
      <button
        className="add-card"
        onMouseDown={(e) => {
          e.preventDefault()
          editor.chain().focus().appendCard().run()
        }}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        加一张卡
      </button>
    </div>
  )
}
