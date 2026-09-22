import { useMemo, useRef, useState, useLayoutEffect, Fragment } from 'react'
import { useBookStore, type Book } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { coverBackground } from './Bookshelf'

// 一页"内容区"尺寸（固定，跟视口无关）——排满就翻下一页。宽屏两页一行、窄屏一页
// 一行由 CSS flex-wrap 决定，跟分页无关，所以改窗口宽度不用重新分页。
const CONTENT_W = 372
const CONTENT_H = 560

type Item =
  | { type: 'chapter' | 'h1' | 'h2'; text: string; runs: Run[]; cardStart: boolean }
  | { type: 'body'; text: string; runs: Run[]; cardStart: boolean }
  // 列表/引用/注：runCont = 紧跟在同样式的段落后面（连成一块，"注"标签只挂第一段）
  | { type: BlockStyle; text: string; runs: Run[]; cardStart: boolean; runCont: boolean }

type BlockStyle = 'bullet' | 'quote' | 'note'
const BLOCK_STYLES: ReadonlySet<string> = new Set(['bullet', 'quote', 'note'])

// 一段里的一截文字加上它带的行内标记。段落的 text 是所有 run 拼起来的纯文本——
// 分页按字数算，所以 text 与 runs 必须始终一致。
export type Run = { text: string; em?: true; refer?: true; strike?: true }

// 排进某一页的一片内容（正文可能是被拆开的一截）。
type PageItem = { cls: string; runs: Run[] }

function paraStyle(p: any): 'chapter' | 'h1' | 'h2' | BlockStyle | 'body' {
  const s = p?.attrs?.style
  return s === 'chapter' || s === 'h1' || s === 'h2' || BLOCK_STYLES.has(s) ? s : 'body'
}
function paraText(p: any): string {
  return paraRuns(p)
    .map((r) => r.text)
    .join('')
}

// 段落 JSON → run 串。emphasis/refer/strike 三个 mark 翻成 run 上的标志，
// 排版视图就能跟编辑器里一样把它们画出来（以前这里只取文字，标记全丢了）。
export function paraRuns(p: any): Run[] {
  const runs: Run[] = []
  ;(p?.content || []).forEach((n: any) => {
    if (n?.type !== 'text' || !n.text) return
    const types = new Set<string>((n.marks || []).map((m: any) => m?.type))
    runs.push({
      text: n.text,
      ...(types.has('emphasis') ? { em: true as const } : {}),
      ...(types.has('refer') ? { refer: true as const } : {}),
      ...(types.has('strike') ? { strike: true as const } : {}),
    })
  })
  return runs
}

// 取 [start, end) 这一段字对应的 run 串——段落被翻页切开时，标记要跟着切到
// 正确的那半边去。边界上不留空 run。
export function sliceRuns(runs: Run[], start: number, end: number): Run[] {
  const out: Run[] = []
  let at = 0
  for (const run of runs) {
    const from = Math.max(start, at)
    const to = Math.min(end, at + run.text.length)
    if (to > from) out.push({ ...run, text: run.text.slice(from - at, to - at) })
    at += run.text.length
  }
  return out
}

// doc → 一串"项"（章/节/正文）。每张卡（除第一张）前空一行。
export function buildItems(doc: any): Item[] {
  const items: Item[] = []
  const cards = doc?.content || []
  cards.forEach((card: any, ci: number) => {
    const paras = card?.content || []
    paras.forEach((p: any, pi: number) => {
      const style = paraStyle(p)
      const cardStart = pi === 0 && ci > 0
      const runs = paraRuns(p)
      const text = runs.map((r) => r.text).join('')
      if (style === 'bullet' || style === 'quote' || style === 'note') {
        const runCont = !cardStart && items.length > 0 && items[items.length - 1].type === style
        items.push({ type: style, text, runs, cardStart, runCont })
      } else {
        items.push({ type: style, text, runs, cardStart })
      }
    })
  })
  return items
}

// run 上的标记 → class。量高和渲染共用这一条规则，所以量出来的就是排出来的。
function runClass(run: Run): string {
  return [run.em ? 'ts-em' : '', run.refer ? 'ts-refer' : '', run.strike ? 'ts-strike' : '']
    .filter(Boolean)
    .join(' ')
}

// Hero 里可点着改的一行（副标题 / 作者）。
function EditableLine({
  value,
  placeholder,
  className,
  prefix,
  onSave,
}: {
  value: string
  placeholder: string
  className: string
  prefix?: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (editing) {
    return (
      <input
        className={`ts-hero-edit ${className}`}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onSave(draft.trim())
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(draft.trim())
            setEditing(false)
          }
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <p
      className={`${className}${value ? '' : ' ts-hero-empty'}`}
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
    >
      {prefix}
      {value || placeholder}
    </p>
  )
}

export function TypesetView({ book }: { book: Book }) {
  const setBookSubtitle = useBookStore((s) => s.setBookSubtitle)
  const setBookAuthor = useBookStore((s) => s.setBookAuthor)
  const session = useAuthStore((s) => s.session)
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, any>
  const defaultAuthor: string = meta.full_name || meta.name || (session?.user?.email ? session.user.email.split('@')[0] : '')

  const items = useMemo(() => buildItems(book.doc), [book.doc])
  const [pages, setPages] = useState<PageItem[][]>([])
  const measureRef = useRef<HTMLDivElement>(null)

  // 逐字连续分页：一页填满就把段落从当前那一行切开、余下接下一页（不是整段挪走）。
  // 章(chapter)强制另起一页。间距全用 padding，量高走 getBoundingClientRect（含 padding/border，
  // 不含 margin），所以量出来就是排版时的真实占位。只读视图 doc 不变，只在内容变化时跑一次。
  useLayoutEffect(() => {
    const box = measureRef.current
    if (!box) return
    const mp = document.createElement('p')
    box.innerHTML = ''
    box.appendChild(mp)
    // 量高时把标记也摆上去：加粗更宽、着重号更高，不算进去分页就会算少。
    const heightOf = (cls: string, runs: Run[]) => {
      mp.className = cls
      mp.innerHTML = ''
      if (!runs.some((r) => r.text)) mp.textContent = ' '
      else
        for (const run of runs) {
          const span = document.createElement('span')
          const c = runClass(run)
          if (c) span.className = c
          span.textContent = run.text
          mp.appendChild(span)
        }
      return mp.getBoundingClientRect().height
    }
    const oneChar = (cls: string) => heightOf(cls, [{ text: '一' }])
    // runs 里最多能塞进 maxH 高度的前缀字数（二分）
    const fitChars = (runs: Run[], total: number, maxH: number, cls: string) => {
      if (heightOf(cls, runs) <= maxH) return total
      let lo = 0
      let hi = total
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (heightOf(cls, sliceRuns(runs, 0, mid)) <= maxH) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    const budget = CONTENT_H
    const out: PageItem[][] = []
    let cur: PageItem[] = []
    let used = 0
    const flush = () => {
      if (cur.length) {
        out.push(cur)
        cur = []
        used = 0
      }
    }
    let dropNext = false // 章之后的第一段正文首字下沉

    for (const it of items) {
      if (it.type === 'chapter') {
        flush() // 章另起一页
        const cls = 'ts-head ts-chapter'
        used += heightOf(cls, it.runs)
        cur.push({ cls, runs: it.runs })
        dropNext = true
        continue
      }
      if (it.type === 'h1' || it.type === 'h2') {
        const cls = `ts-head ts-${it.type}${it.cardStart ? ' ts-card-start' : ''}`
        const hh = heightOf(cls, it.runs)
        if (cur.length && used + hh > budget) flush()
        used += hh
        cur.push({ cls, runs: it.runs })
        continue
      }
      // 正文（以及列表/引用/注——它们按正文一样排，只是多一个样式 class）：
      // 能整段放下就放，放不下就切
      // 段落按字数游标往前推：at = 已经排掉的字数，剩下那截 = [at, total)
      const total = it.text.length
      let at = 0
      const block = it.type === 'body' ? '' : ` ts-${it.type}${'runCont' in it && it.runCont ? ' ts-run-cont' : ''}`
      const dropcap = it.type === 'body' && dropNext && !!it.text.trim()
      dropNext = false
      let firstPiece = true
      if (!it.text.trim()) {
        // 空段也占一个空行的位
        const cls = 'ts-body' + block
        const hh = oneChar(cls)
        if (cur.length && used + hh > budget) flush()
        used += hh
        cur.push({ cls, runs: [{ text: ' ' }] })
        continue
      }
      while (at < total) {
        let remaining = budget - used
        const cls =
          'ts-body' +
          block +
          (dropcap && firstPiece ? ' ts-dropcap' : '') +
          (it.cardStart && firstPiece ? ' ts-card-start' : '') +
          // 段落被翻页切开后，续接的那一截不是新段落，不该首行缩进
          (firstPiece ? '' : ' ts-cont')
        // 这一页剩太少（连一行都放不下）→ 先翻页
        if (remaining < oneChar(cls) && cur.length) {
          flush()
          remaining = budget
        }
        const rest = sliceRuns(it.runs, at, total)
        const full = heightOf(cls, rest)
        if (full <= remaining) {
          used += full
          cur.push({ cls, runs: rest })
          at = total
        } else {
          const k = fitChars(rest, total - at, remaining, cls)
          if (k <= 0) {
            flush()
            continue
          }
          cur.push({ cls, runs: sliceRuns(it.runs, at, at + k) })
          at += k
          firstPiece = false
          flush() // 余下接下一页
        }
      }
    }
    flush()
    setPages(out)
  }, [items])

  const author = book.author || defaultAuthor

  return (
    <div className="ts-root">
      <div className="ts-hero" style={{ backgroundImage: coverBackground(book) }}>
        <div className="ts-hero-inner">
          <span className="ts-hero-kicker">A BOOK</span>
          <h1 className="ts-hero-title">{book.title}</h1>
          <EditableLine
            value={book.subtitle || ''}
            placeholder="加个副标题…"
            className="ts-hero-sub"
            onSave={(v) => setBookSubtitle(book.id, v)}
          />
          <span className="ts-hero-rule" />
          <EditableLine
            value={book.author || ''}
            placeholder={defaultAuthor || '作者'}
            className="ts-hero-author"
            prefix="By "
            onSave={(v) => setBookAuthor(book.id, v)}
          />
          {author ? null : null}
        </div>
      </div>

      {/* 隐藏量高层：宽度=一页内容区，字体/字号跟真实页一致 */}
      <div className="ts-measure ts-flow" ref={measureRef} aria-hidden="true" style={{ width: CONTENT_W }} />

      <div className="ts-pages">
        {pages.map((pageItems, pi) => (
          <div className="ts-page" key={pi}>
            <div className="ts-flow" style={{ width: CONTENT_W }}>
              {pageItems.map((it, i) => (
                <p className={it.cls} key={i}>
                  {it.runs.map((run, ri) => {
                    const c = runClass(run)
                    return c ? (
                      <span className={c} key={ri}>
                        {run.text}
                      </span>
                    ) : (
                      <Fragment key={ri}>{run.text}</Fragment>
                    )
                  })}
                </p>
              ))}
            </div>
            <span className="ts-page-num">{pi + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
