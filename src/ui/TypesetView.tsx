import { useMemo, useRef, useState, useLayoutEffect, Fragment } from 'react'
import { useBookStore, type Book } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { usePrefsStore, type Layout, type ReadLang } from '../state/prefsStore'
import { splitParagraphs } from '../editor/enText'
import { coverBackground } from './Bookshelf'

// 版式预设。分页的单位是"栏"：一栏的内容区尺寸固定（跟视口无关），排满就换下一栏，
// cols 栏凑成一页。宽屏几页一行由 CSS flex-wrap 决定，跟分页无关，所以改窗口宽度
// 不用重新分页。页面外框（宽高、页边距）在 CSS 里按 .ts-<layout> 配，两边要对得上。
type LayoutSpec = {
  cols: number
  colW: number
  colH: number
  colGap: number
  chapterBreak: boolean // 章另起一页
  dropcap: boolean // 章后首段首字下沉
  numbered: boolean // 章/节自动编号 1 / 1.1 / 1.1.1
}
const LAYOUTS: Record<Layout, LayoutSpec> = {
  book: { cols: 1, colW: 372, colH: 560, colGap: 0, chapterBreak: true, dropcap: true, numbered: false },
  // 接近 A4 比例的双栏：页 720 宽、内容 608 = 290×2 + 28
  paper: { cols: 2, colW: 290, colH: 900, colGap: 28, chapterBreak: false, dropcap: false, numbered: true },
}
const LAYOUT_OPTIONS: { key: Layout; label: string }[] = [
  { key: 'book', label: '书' },
  { key: 'paper', label: '论文' },
]
const LANG_OPTIONS: { key: ReadLang; label: string }[] = [
  { key: 'zh', label: '中' },
  { key: 'en', label: '英' },
  { key: 'both', label: '对照' },
]

// en = 这段是英文；pending = 英文模式下这张卡还没写英文，退回显示中文（压淡）
// echo = 对照模式里紧跟中文那段的英文——标题编号沿用中文那条，不另数
type Lang = { en?: true; pending?: true; echo?: true }
type Item =
  | ({ type: 'chapter' | 'h1' | 'h2'; text: string; runs: Run[]; cardStart: boolean } & Lang)
  | ({ type: 'body'; text: string; runs: Run[]; cardStart: boolean } & Lang)
  // 列表/引用/注：runCont = 紧跟在同样式的段落后面（连成一块，"注"标签只挂第一段）
  | ({ type: BlockStyle; text: string; runs: Run[]; cardStart: boolean; runCont: boolean } & Lang)

type BlockStyle = 'bullet' | 'quote' | 'note'
const BLOCK_STYLES: ReadonlySet<string> = new Set(['bullet', 'quote', 'note'])

// 一段里的一截文字加上它带的行内标记。段落的 text 是所有 run 拼起来的纯文本——
// 分页按字数算，所以 text 与 runs 必须始终一致。
export type Run = { text: string; em?: true; refer?: true; strike?: true }

// 排进某一页的一片内容（正文可能是被拆开的一截）。
type PageItem = { cls: string; runs: Run[]; en?: true }

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
//
// 英文存在卡的 attrs.en 上（纯文本段落数组，段数不锁 1:1）。段数跟中文对得上时
// 按序号继承中文的块样式——标题还是标题；对不上就全当正文。英文模式下没写英文的
// 卡退回中文（标 pending，压淡），不让整段内容从阅读里消失。对照模式每张卡先中后英。
export function buildItems(doc: any, lang: ReadLang = 'zh'): Item[] {
  const items: Item[] = []
  const push = (style: ReturnType<typeof paraStyle>, runs: Run[], cardStart: boolean, extra: Lang) => {
    const text = runs.map((r) => r.text).join('')
    if (style === 'bullet' || style === 'quote' || style === 'note') {
      const prev = items[items.length - 1]
      const runCont = !cardStart && !!prev && prev.type === style && !!prev.en === !!extra.en
      items.push({ type: style, text, runs, cardStart, runCont, ...extra })
    } else {
      items.push({ type: style, text, runs, cardStart, ...extra })
    }
  }
  const cards = doc?.content || []
  cards.forEach((card: any, ci: number) => {
    const paras = card?.content || []
    const rawEn = card?.attrs?.en
    const en = Array.isArray(rawEn) ? splitParagraphs(rawEn.filter((x: unknown) => typeof x === 'string')) : []
    const showZh = lang !== 'en' || en.length === 0
    const pending: Lang = lang === 'en' ? { pending: true } : {}
    if (showZh)
      paras.forEach((p: any, pi: number) => push(paraStyle(p), paraRuns(p), pi === 0 && ci > 0, pending))
    if (lang !== 'zh' && en.length) {
      const aligned = en.length === paras.length
      en.forEach((t, i) =>
        push(aligned ? paraStyle(paras[i]) : 'body', [{ text: t }], i === 0 && ci > 0 && !showZh, showZh ? { en: true, echo: true } : { en: true }),
      )
    }
  })
  return items
}

// 章/节编号。只数文档里真出现过的标题层级：只有 h1/h2 的书，h1 就是 "1"、h2 是 "1.1"，
// 不会冒出 "0.1"。编号作为一个前缀 run 插在标题前面（标题不参与跨栏切分，多一个 run 无妨）。
const HEAD_LEVELS = ['chapter', 'h1', 'h2'] as const
export function numberHeadings(items: Item[]): Item[] {
  const present = HEAD_LEVELS.filter((lv) => items.some((it) => it.type === lv))
  const counters = present.map(() => 0)
  return items.map((it) => {
    const depth = present.indexOf(it.type as (typeof HEAD_LEVELS)[number])
    if (depth < 0) return it
    if (!it.echo || counters[depth] === 0) counters[depth]++
    if (!it.echo) for (let d = depth + 1; d < counters.length; d++) counters[d] = 0
    const label = counters.slice(0, depth + 1).join('.')
    return { ...it, runs: [{ text: label + '\u2003' }, ...it.runs] } as Item
  })
}

function langOf(cls: string): string {
  return / ts-en\b/.test(cls) ? 'en' : ''
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

  const layout = usePrefsStore((s) => s.prefs.layout)
  const setLayout = usePrefsStore((s) => s.setLayout)
  const readLang = usePrefsStore((s) => s.prefs.readLang)
  const setReadLang = usePrefsStore((s) => s.setReadLang)
  const spec = LAYOUTS[layout]
  const author = book.author || defaultAuthor

  const items = useMemo(() => {
    const base = buildItems(book.doc, readLang)
    return spec.numbered ? numberHeadings(base) : base
  }, [book.doc, spec.numbered, readLang])
  // 每一栏装的内容；按 spec.cols 栏一页凑成 pages
  const [cols, setCols] = useState<PageItem[][]>([])
  const measureRef = useRef<HTMLDivElement>(null)
  const headMeasureRef = useRef<HTMLDivElement>(null)

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
      // 英文段带 lang=en（连字符断词要靠它），量高时也得一样，不然断行对不上
      mp.lang = langOf(cls)
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

    // 论文版第一页顶上是通栏的标题区，第一页那几栏的可用高度要扣掉它
    const headH = layout === 'paper' ? headMeasureRef.current?.firstElementChild?.getBoundingClientRect().height ?? 0 : 0
    const out: PageItem[][] = []
    let cur: PageItem[] = []
    let used = 0
    let budget = spec.colH - headH
    const flush = () => {
      if (cur.length) {
        out.push(cur)
        cur = []
        used = 0
        budget = out.length < spec.cols ? spec.colH - headH : spec.colH
      }
    }
    // 换页（不只是换栏）：把当前页剩下的栏补成空栏
    const pageBreak = () => {
      flush()
      while (out.length % spec.cols) out.push([])
      budget = spec.colH
    }
    let dropNext = false // 章之后的第一段正文首字下沉
    let lineH = 0 // 正文一行的高度，标题"不落单"要用

    for (const it of items) {
      const lc = it.en ? ' ts-en' : it.pending ? ' ts-pending' : ''
      // 对照模式里英文章名紧跟中文章名，同一页，不再另起
      if (it.type === 'chapter' && spec.chapterBreak && !it.echo) {
        pageBreak() // 章另起一页
        const cls = 'ts-head ts-chapter' + lc
        used += heightOf(cls, it.runs)
        cur.push({ cls, runs: it.runs })
        dropNext = spec.dropcap
        continue
      }
      if (it.type === 'chapter' || it.type === 'h1' || it.type === 'h2') {
        const cls = `ts-head ts-${it.type}${it.cardStart ? ' ts-card-start' : ''}${lc}`
        const hh = heightOf(cls, it.runs)
        // 标题后面至少要跟得下一行正文，不然标题孤零零落在栏底
        if (!lineH) lineH = oneChar('ts-body')
        if (cur.length && used + hh + lineH > budget) flush()
        used += hh
        cur.push({ cls, runs: it.runs })
        if (it.type === 'chapter') dropNext = spec.dropcap
        continue
      }
      // 正文（以及列表/引用/注——它们按正文一样排，只是多一个样式 class）：
      // 能整段放下就放，放不下就切
      // 段落按字数游标往前推：at = 已经排掉的字数，剩下那截 = [at, total)
      const total = it.text.length
      let at = 0
      const block = (it.type === 'body' ? '' : ` ts-${it.type}${'runCont' in it && it.runCont ? ' ts-run-cont' : ''}`) + lc
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
          let k = fitChars(rest, total - at, remaining, cls)
          // 英文别从单词中间切：退到这一截里最后一个空白之后
          if (it.en && k > 0) {
            const ws = it.text.slice(at, at + k).search(/\s\S*$/)
            if (ws > 0) k = ws + 1
          }
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
    setCols(out)
  }, [items, spec, layout, book.title, book.subtitle, author])

  const pages: PageItem[][][] = []
  for (let i = 0; i < cols.length; i += spec.cols) pages.push(cols.slice(i, i + spec.cols))

  const renderCol = (colItems: PageItem[], key: number) => (
    <div className="ts-flow" key={key} style={{ width: spec.colW }}>
      {colItems.map((it, i) => (
        <p className={it.cls} lang={langOf(it.cls) || undefined} key={i}>
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
  )

  // 论文抬头：通栏、居中。量高层里放一份不可编辑的同款，分页前先量它占多高。
  const paperHead = (editable: boolean) => (
    <div className="ts-paper-head">
      <h1 className="ts-paper-title">{book.title}</h1>
      {editable ? (
        <>
          <EditableLine
            value={book.subtitle || ''}
            placeholder="加个副标题…"
            className="ts-paper-sub"
            onSave={(v) => setBookSubtitle(book.id, v)}
          />
          <EditableLine
            value={book.author || ''}
            placeholder={defaultAuthor || '作者'}
            className="ts-paper-author"
            onSave={(v) => setBookAuthor(book.id, v)}
          />
        </>
      ) : (
        <>
          <p className="ts-paper-sub">{book.subtitle || '加个副标题…'}</p>
          <p className="ts-paper-author">{author || '作者'}</p>
        </>
      )}
    </div>
  )

  return (
    <div className={`ts-root ts-${layout} ts-lang-${readLang}`}>
      <div className="ts-switches">
        <div className="ts-layout-switch" role="group" aria-label="语言">
          {LANG_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={readLang === o.key ? 'on' : undefined}
              aria-pressed={readLang === o.key}
              onClick={() => setReadLang(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="ts-layout-switch" role="group" aria-label="版式">
          {LAYOUT_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={layout === o.key ? 'on' : undefined}
              aria-pressed={layout === o.key}
              onClick={() => setLayout(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {layout === 'book' && (
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
        </div>
      </div>
      )}

      {/* 隐藏量高层：宽度=一栏内容区，字体/字号跟真实页一致 */}
      <div className="ts-measure ts-flow" ref={measureRef} aria-hidden="true" style={{ width: spec.colW }} />
      {layout === 'paper' && (
        <div className="ts-measure" ref={headMeasureRef} aria-hidden="true" style={{ width: spec.colW * spec.cols + spec.colGap * (spec.cols - 1) }}>
          {paperHead(false)}
        </div>
      )}

      <div className="ts-pages">
        {pages.map((pageCols, pi) => (
          <div className="ts-page" key={pi}>
            {layout === 'paper' && pi === 0 && paperHead(true)}
            <div className="ts-cols" style={{ gap: spec.colGap }}>
              {pageCols.map(renderCol)}
            </div>
            <span className="ts-page-num">{pi + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
