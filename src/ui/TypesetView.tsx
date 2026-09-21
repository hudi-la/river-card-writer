import { useMemo, useRef, useState, useLayoutEffect, Fragment } from 'react'
import { useBookStore, type Book } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { coverBackground } from './Bookshelf'

// 一页"内容区"尺寸（固定，跟视口无关）——排满就翻下一页。宽屏两页一行、窄屏一页
// 一行由 CSS flex-wrap 决定，跟分页无关，所以改窗口宽度不用重新分页。
const CONTENT_W = 372
const CONTENT_H = 560

type Item =
  | { type: 'chapter' | 'h1' | 'h2'; text: string; cardStart: boolean }
  | { type: 'body'; text: string; cardStart: boolean }
  // 列表/引用/注：runCont = 紧跟在同样式的段落后面（连成一块，"注"标签只挂第一段）
  | { type: BlockStyle; text: string; cardStart: boolean; runCont: boolean }

type BlockStyle = 'bullet' | 'quote' | 'note'
const BLOCK_STYLES: ReadonlySet<string> = new Set(['bullet', 'quote', 'note'])

// 排进某一页的一片内容（正文可能是被拆开的一截）。
type PageItem = { cls: string; text: string }

function paraStyle(p: any): 'chapter' | 'h1' | 'h2' | BlockStyle | 'body' {
  const s = p?.attrs?.style
  return s === 'chapter' || s === 'h1' || s === 'h2' || BLOCK_STYLES.has(s) ? s : 'body'
}
function paraText(p: any): string {
  const out: string[] = []
  ;(p?.content || []).forEach((n: any) => {
    if (n?.type === 'text' && n.text) out.push(n.text)
  })
  return out.join('')
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
      if (style === 'bullet' || style === 'quote' || style === 'note') {
        const runCont = !cardStart && items.length > 0 && items[items.length - 1].type === style
        items.push({ type: style, text: paraText(p), cardStart, runCont })
      } else {
        items.push({ type: style, text: paraText(p), cardStart })
      }
    })
  })
  return items
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
    const heightOf = (cls: string, text: string) => {
      mp.className = cls
      mp.textContent = text || ' '
      return mp.getBoundingClientRect().height
    }
    // rest 里最多能塞进 maxH 高度的前缀字数（二分）
    const fitChars = (text: string, maxH: number, cls: string) => {
      if (heightOf(cls, text) <= maxH) return text.length
      let lo = 0
      let hi = text.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (heightOf(cls, text.slice(0, mid)) <= maxH) lo = mid
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
        used += heightOf(cls, it.text)
        cur.push({ cls, text: it.text })
        dropNext = true
        continue
      }
      if (it.type === 'h1' || it.type === 'h2') {
        const cls = `ts-head ts-${it.type}${it.cardStart ? ' ts-card-start' : ''}`
        const hh = heightOf(cls, it.text)
        if (cur.length && used + hh > budget) flush()
        used += hh
        cur.push({ cls, text: it.text })
        continue
      }
      // 正文（以及列表/引用/注——它们按正文一样排，只是多一个样式 class）：
      // 能整段放下就放，放不下就切
      let rest = it.text
      const block = it.type === 'body' ? '' : ` ts-${it.type}${'runCont' in it && it.runCont ? ' ts-run-cont' : ''}`
      const dropcap = it.type === 'body' && dropNext && !!rest.trim()
      dropNext = false
      let firstPiece = true
      if (!rest.trim()) {
        // 空段也占一个空行的位
        const cls = 'ts-body' + block
        const hh = heightOf(cls, ' ')
        if (cur.length && used + hh > budget) flush()
        used += hh
        cur.push({ cls, text: ' ' })
        continue
      }
      while (rest.length) {
        let remaining = budget - used
        const cls =
          'ts-body' +
          block +
          (dropcap && firstPiece ? ' ts-dropcap' : '') +
          (it.cardStart && firstPiece ? ' ts-card-start' : '') +
          // 段落被翻页切开后，续接的那一截不是新段落，不该首行缩进
          (firstPiece ? '' : ' ts-cont')
        // 这一页剩太少（连一行都放不下）→ 先翻页
        if (remaining < heightOf(cls, '一') && cur.length) {
          flush()
          remaining = budget
        }
        const full = heightOf(cls, rest)
        if (full <= remaining) {
          used += full
          cur.push({ cls, text: rest })
          rest = ''
        } else {
          const k = fitChars(rest, remaining, cls)
          if (k <= 0) {
            flush()
            continue
          }
          const piece = rest.slice(0, k)
          cur.push({ cls, text: piece })
          rest = rest.slice(k)
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
                  {it.text}
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
