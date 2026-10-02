import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Languages, PanelLeft, PanelRight, Pencil, Square } from 'lucide-react'
import { useBookStore, type Book } from '../state/bookStore'
import { usePrefsStore } from '../state/prefsStore'
import { LeftNav } from './LeftNav'
import { RiverEditor } from '../editor/RiverEditor'
import { BoxView } from './BoxView'
import { ReadingSettings } from './ReadingSettings'
import { TypesetView } from './TypesetView'
import { PrepSidebar } from './PrepSidebar'
import { useActiveCardId } from './useActiveCardId'
import { useEditorBridge } from '../state/editorBridge'
import { useToastStore } from '../state/toastStore'
import { requestPrep, makeFetchFreqs } from '../prep/client'
import { createVerifier, type Tier } from '../prep/verify'
import { runPrep, type CardInput } from '../prep/runPrep'
import { toAiPolicy } from '../prep/types'

const FONT_STACK: Record<'serif' | 'sans', string> = {
  serif: "Georgia,'Songti SC','Noto Serif',serif",
  sans: "system-ui,'PingFang SC','Noto Sans',sans-serif",
}

const READ_MODE_KEY = 'card-writer:read-mode'


// 拖拽状态用 useRef 而不是 useState：pointermove 期间不需要触发 Workspace
// 重渲染——setRailWidth 改 prefsStore，prefs 变化本身会重渲染一次去更新 CSS
// var，再叠一份组件 state 只是重复劳动。
type RailDragState = { startX: number; startWidth: number }

// 书内标题：点击/双击进入编辑态（跟书柜封面双击改名同一套手感，只是这里单击
// 也能进——书内没有"点标题会不小心开别的东西"这个顾虑，不需要像 Bookshelf
// 的 BookCard 那样把单击专门让给"开书"）。Enter/失焦提交，空标题（trim 后为
// 空）忽略不保存，退回编辑前的标题。book 切换时（key=book.id 由父组件保证
// 重新挂载）本地 draft 天然跟着重置，不需要额外 effect 同步。
function WorkspaceTitle({ book, renameBook }: { book: Book; renameBook: (id: string, title: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(book.title)

  const commitRename = () => {
    const title = draft.trim()
    if (title && title !== book.title) renameBook(book.id, title)
    else setDraft(book.title)
    setEditing(false)
  }

  const beginEdit = () => {
    setDraft(book.title)
    setEditing(true)
  }

  return editing ? (
    <input
      className="workspace-title-edit"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitRename()
        if (e.key === 'Escape') {
          setDraft(book.title)
          setEditing(false)
        }
      }}
    />
  ) : (
    <h1 className="workspace-title" onClick={beginEdit} onDoubleClick={beginEdit}>
      {book.title}
    </h1>
  )
}

export function Workspace() {
  const viewKind = useBookStore((s) => s.viewKind)
  const activeBoxId = useBookStore((s) => s.activeBoxId)
  const activeBookId = useBookStore((s) => s.library.activeBookId)
  const book = useBookStore((s) => s.activeBook())
  const goToShelf = useBookStore((s) => s.goToShelf)
  const renameBook = useBookStore((s) => s.renameBook)
  const prefs = usePrefsStore((s) => s.prefs)
  const setRailWidth = usePrefsStore((s) => s.setRailWidth)
  const setCardHints = useBookStore((s) => s.setCardHints)
  const setAiPolicy = useBookStore((s) => s.setAiPolicy)
  const railDragRef = useRef<RailDragState | null>(null)

  // 双语并排：本地开关（离开这本书自然重置）。开着时每张卡变两列、右边出备料边栏。
  const [bilingual, setBilingual] = useState(false)
  // 备料面板单独一个开关：不想要提词时可以只关面板，中英两栏照样写。
  const [prepOpen, setPrepOpen] = useState(true)
  // 目录栏。双语模式下最缺的就是横向空间（两栏正文 + 备料边栏），目录那一栏
  // 该让出来——但不能一关了之，作者还要跳章节，所以给一个开关随时叫回来。
  const [navOpen, setNavOpen] = useState(true)
  const [prepping, setPrepping] = useState(false)
  // 整章备料的进度。null = 没在跑。实测一次模型调用 24–60 秒，所以进度是必须的
  // ——没有它，作者面对的是几分钟的静默，跟卡死没有区别。
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // 失败必须留在界面上。原来只弹一个 5 秒的 toast，然后边栏退回"还没备料"——
  // 于是"失败了"和"从没试过"长得一模一样，作者既不知道发生过什么，也看不到原因。
  const [prepError, setPrepError] = useState<string | null>(null)
  const [prepWarnings, setPrepWarnings] = useState<string[]>([])
  // 「停」：不中断已经发出的请求（那次调用的钱已经花了），只是不再发新的。
  const stopRef = useRef(false)
  // 查证结果按词形累积。整个会话共用一个 verifier，所以同一个词只查一次。
  const [tiers, setTiers] = useState<Map<string, Tier>>(new Map())
  const verify = useMemo(() => createVerifier(makeFetchFreqs()), [])
  const activeCardId = useActiveCardId()
  // 阅读/排版视图：本地开关（离开这本书自然重置）。开着时隐藏目录栏、正文换成只读排版。
  // 存一份到 sessionStorage：刷新不会跑卸载 cleanup，标记还在 → 恢复到阅读视图；
  // 正常返回书柜时卸载 cleanup 清掉标记，保持"离开这本书自然重置"的原语义。
  const [readMode, setReadModeRaw] = useState(() => {
    try {
      return sessionStorage.getItem(READ_MODE_KEY) === '1'
    } catch {
      return false
    }
  })
  const setReadMode = (fn: (v: boolean) => boolean) =>
    setReadModeRaw((v) => {
      const next = fn(v)
      try {
        sessionStorage.setItem(READ_MODE_KEY, next ? '1' : '0')
      } catch {
        // 存不上就只是刷新后回编辑视图，不影响使用
      }
      return next
    })
  useEffect(
    () => () => {
      try {
        sessionStorage.removeItem(READ_MODE_KEY)
      } catch {
        // 同上
      }
    },
    [],
  )

  // useLayoutEffect (not useEffect) so persisted prefs are applied to the
  // CSS vars before the browser paints the first frame — otherwise a user
  // with non-default prefs sees one flash of the :root defaults. Same effect
  // also drives --rail-width live while dragging: setRailWidth below updates
  // prefs, which re-runs this effect before paint on every drag step.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--reading-font', FONT_STACK[prefs.font])
    root.style.setProperty('--reading-size', `${prefs.size}px`)
    root.style.setProperty('--reading-measure', `${prefs.measure}px`)
    root.style.setProperty('--rail-width', `${prefs.railWidth}px`)
  }, [prefs])

  // 目录栏拖拽把手：pointer capture 让拖拽过程即使指针移出这条 6px 的细把手也
  // 继续收到 move/up 事件，同时天然阻止拖拽时选中正文文字。宽度在 pointermove
  // 时就通过 setRailWidth 持久化（跟 ReadingSettings 里字号/行宽滑杆同一套
  // 约定：拖动过程本身就是"边拖边存"，pointerup 不用再单独存一次）。
  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    railDragRef.current = { startX: e.clientX, startWidth: usePrefsStore.getState().prefs.railWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.classList.add('dragging')
  }
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = railDragRef.current
    if (!drag) return
    setRailWidth(drag.startWidth + (e.clientX - drag.startX))
  }
  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!railDragRef.current) return
    railDragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    e.currentTarget.classList.remove('dragging')
  }

  // 编辑器里每张卡的 cardId + 各段中文。
  const cardsFromEditor = (): CardInput[] => {
    const editor = useEditorBridge.getState().editor
    if (!editor) return []
    const out: CardInput[] = []
    editor.state.doc.forEach((card) => {
      const cardId: string | null = card.attrs.cardId
      if (!cardId) return
      const zhTexts: string[] = []
      card.forEach((para) => zhTexts.push(para.textContent))
      out.push({ cardId, zhTexts })
    })
    return out
  }

  // 备料的共同通路。刻意不做自动后台备料：作者还在改的时候它在烧钱，而且那不是
  // "被动的好画布"该干的事。备料永远是按下去的。
  const runPrepOn = async (cards: CardInput[], label: string) => {
    const showToast = useToastStore.getState().show
    if (cards.length === 0) {
      showToast({ text: '这些卡都已经备过了。想重算某一张，把光标放进去按「备这张卡」。', kind: 'info' })
      return
    }
    stopRef.current = false
    setPrepError(null)
    setPrepWarnings([])
    setPrepping(true)
    try {
      const out = await runPrep(cards, {
        requestPrep: (zhTexts) => requestPrep(zhTexts, toAiPolicy(book?.aiPolicy)),
        verify,
        onCardDone: (cardId, result) => setCardHints(cardId, result),
        onWarnings: (w) => setPrepWarnings((prev) => [...prev, ...w]),
        onTiers: (m) => setTiers((prev) => new Map([...prev, ...m])),
        onProgress: (done, total) => setProgress({ done, total }),
        onError: (_cardId, error) => {
          setPrepError(error)
          showToast({ text: `备料失败：${error}`, kind: 'error', durationMs: 5000 })
        },
        shouldStop: () => stopRef.current,
      })
      const parts = [`${label}：${out.done} 张卡`]
      if (out.failed > 0) parts.push(`${out.failed} 张失败`)
      if (out.stopped) parts.push('已停下')
      showToast({ text: parts.join('，'), kind: out.failed > 0 ? 'info' : 'success' })
    } finally {
      setPrepping(false)
      setProgress(null)
    }
  }

  // 「备这张卡」：一次调用，只等你现在要写的那一段。显式动作，所以总是重跑。
  const prepThisCard = () => {
    const card = cardsFromEditor().find((c) => c.cardId === activeCardId)
    if (!card) {
      useToastStore.getState().show({ text: '先把光标放进一张卡里', kind: 'info' })
      return
    }
    return runPrepOn([card], '备料完成')
  }

  // 异常兜底：shell 已经切到 'book' 但没有 activeBook（比如被删掉了）——安全地
  // 不渲染，而不是读 undefined 崩掉。App 下一次渲染通常会跟着 shell 回书柜。
  if (!book) return null

  const showBilingual = bilingual && !readMode && viewKind !== 'box'
  const showPrep = showBilingual && prepOpen

  return (
    <div
      className={
        readMode ? 'read-shell' : `app${showPrep ? ' app--bilingual' : ''}${navOpen ? '' : ' app--no-nav'}`
      }
    >
      {!readMode && navOpen && <LeftNav />}
      {!readMode && navOpen && (
        <div
          className="rail-resize-handle"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        />
      )}
      <main className={showBilingual ? 'page page--bilingual river--bilingual' : 'page'}>
        {/* 顶栏做成 sticky：往下滚正文时这条始终吸在视口顶部，← 书柜 / 书名 / ⚙
            一直够得着（见 .workspace-topbar）。三栏网格 1fr auto 1fr 让书名无论
            两侧按钮多宽都精确居中，且书名保持紧凑——点击区只落在书名本身，不会
            误触整条中缝进改名。 */}
        <div className="workspace-topbar">
          <button className="back-to-shelf" onClick={goToShelf}>
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            书柜
          </button>
          <WorkspaceTitle key={`title-${book.id}`} book={book} renameBook={renameBook} />
          <div className="topbar-right">
            {/* 图标按钮。原来「阅读」「单语」的两个字在窄栏里折成上下两行了，
                所以只留图标——这两个是常用开关，认图标比认字快。 */}
            {!readMode && (
              <button className="icon-toggle" data-on={navOpen ? 'true' : undefined} onClick={() => setNavOpen((v) => !v)} title={navOpen ? '收起目录' : '打开目录'} aria-label={navOpen ? '收起目录' : '打开目录'}>
                <PanelLeft size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}

            <button className="icon-toggle" onClick={() => setReadMode((v) => !v)} title={readMode ? '回到编辑' : '排版预览'} aria-label={readMode ? '回到编辑' : '排版预览'}>
              {readMode ? <Pencil size={16} strokeWidth={1.75} aria-hidden="true" /> : <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />}
            </button>

            {!readMode && viewKind !== 'box' && (
              <button className="icon-toggle" data-on={bilingual ? 'true' : undefined} onClick={() => setBilingual((v) => { setNavOpen(v); return !v })} title={bilingual ? '回到单语' : '中英并排'} aria-label={bilingual ? '回到单语' : '中英并排'}>
                <Languages size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}

            {/* 备料面板的开关，跟边栏右上角那个 × 是同一件事 */}
            {showBilingual && (
              <button className="icon-toggle" data-on={prepOpen ? 'true' : undefined} onClick={() => setPrepOpen((v) => !v)} title={prepOpen ? '收起备料' : '打开备料'} aria-label={prepOpen ? '收起备料' : '打开备料'}>
                <PanelRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}

            {prepping && (
              <button className="topbar-primary is-stop" onClick={() => { stopRef.current = true }} title="不再发新的请求（已发出的那个还会回来）">
                <Square size={11} strokeWidth={2.5} aria-hidden="true" />
                停
              </button>
            )}

            {!readMode && <ReadingSettings />}
          </div>
        </div>
        {readMode ? (
          <TypesetView book={book} />
        ) : viewKind === 'box' ? (
          <BoxView key={activeBoxId} boxId={activeBoxId} />
        ) : (
          <RiverEditor key={activeBookId} />
        )}
      </main>
      {showPrep && (
        <PrepSidebar
          targets={(activeCardId && book.hints?.[activeCardId]?.targets) || []}
          genre={(activeCardId && book.hints?.[activeCardId]?.genre) || 'other'}
          tiers={tiers}
          busy={prepping}
          progress={progress}
          onPrepCard={prepThisCard}
          error={prepError}
          warnings={prepWarnings}
          aiPolicy={toAiPolicy(book.aiPolicy)}
          onPolicyChange={setAiPolicy}
          translation={activeCardId ? book.hints?.[activeCardId]?.translation : undefined}
          onClose={() => setPrepOpen(false)}
        />
      )}
    </div>
  )
}
