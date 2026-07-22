import { useMemo, useRef, useState, useLayoutEffect, Fragment } from 'react'
import { useBookStore, type Book } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { coverBackground } from './Bookshelf'

// 一页的"内容区"尺寸（固定，跟视口无关）——排满就翻下一页；页面本身宽屏两个一行、
// 窄屏一个一行由 CSS flex-wrap 决定，跟分页无关，所以改窗口宽度不需要重新分页。
const CONTENT_W = 372
const CONTENT_H = 560

type Block =
  | { kind: 'heading'; level: 'chapter' | 'h1' | 'h2'; text: string; cardStart: boolean }
  | { kind: 'body'; text: string; dropcap: boolean; cardStart: boolean }

function paraStyle(p: any): 'chapter' | 'h1' | 'h2' | 'body' {
  const s = p?.attrs?.style
  return s === 'chapter' || s === 'h1' || s === 'h2' ? s : 'body'
}
function paraText(p: any): string {
  const out: string[] = []
  ;(p?.content || []).forEach((n: any) => {
    if (n?.type === 'text' && n.text) out.push(n.text)
  })
  return out.join('')
}

// doc → 一串"块"（标题/正文）。章首第一段正文首字下沉；每张卡（除第一张）前空一行。
function buildBlocks(doc: any): Block[] {
  const blocks: Block[] = []
  const cards = doc?.content || []
  let pendingDropcap = true // 开篇第一段正文也来个首字下沉
  cards.forEach((card: any, ci: number) => {
    const paras = card?.content || []
    paras.forEach((p: any, pi: number) => {
      const style = paraStyle(p)
      const text = paraText(p)
      const cardStart = pi === 0 && ci > 0
      if (style !== 'body') {
        blocks.push({ kind: 'heading', level: style, text, cardStart })
        if (style === 'chapter' || style === 'h1') pendingDropcap = true
      } else {
        const dropcap = pendingDropcap && !!text.trim()
        if (dropcap) pendingDropcap = false
        blocks.push({ kind: 'body', text, dropcap, cardStart })
      }
    })
  })
  return blocks
}

function renderBlock(b: Block) {
  if (b.kind === 'heading') {
    const lvl = b.level === 'chapter' ? 'ts-chapter' : b.level === 'h1' ? 'ts-h1' : 'ts-h2'
    return <p className={`ts-head ${lvl}${b.cardStart ? ' ts-card-start' : ''}`}>{b.text || ' '}</p>
  }
  return <p className={`ts-body${b.dropcap ? ' ts-dropcap' : ''}${b.cardStart ? ' ts-card-start' : ''}`}>{b.text || ' '}</p>
}

// Hero 里可点着改的一行（副标题 / 作者）——空的时候显示占位提示，点一下变输入框。
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

  const blocks = useMemo(() => buildBlocks(book.doc), [book.doc])
  const [pages, setPages] = useState<number[][]>([])
  const measureRef = useRef<HTMLDivElement>(null)

  // 量出每个块的实际高度（间距全用 padding 实现，所以 rect 高度已含间距），贪心塞进
  // 一页页固定高度里——塞不下就开下一页。只在内容变化时跑一次（只读视图 doc 不变）。
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const kids = Array.from(el.children) as HTMLElement[]
    const out: number[][] = []
    let cur: number[] = []
    let used = 0
    kids.forEach((kid, i) => {
      const h = kid.getBoundingClientRect().height
      if (cur.length && used + h > CONTENT_H) {
        out.push(cur)
        cur = []
        used = 0
      }
      cur.push(i)
      used += h
    })
    if (cur.length) out.push(cur)
    setPages(out)
  }, [blocks])

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
          {!book.author && author && <span className="ts-hero-author-hint" />}
        </div>
      </div>

      {/* 隐藏的量高层：宽度=一页内容区，字体/字号跟真实页一致 */}
      <div className="ts-measure ts-flow" ref={measureRef} aria-hidden="true" style={{ width: CONTENT_W }}>
        {blocks.map((b, i) => (
          <Fragment key={i}>{renderBlock(b)}</Fragment>
        ))}
      </div>

      <div className="ts-pages">
        {pages.map((pageBlocks, pi) => (
          <div className="ts-page" key={pi}>
            <div className="ts-flow" style={{ width: CONTENT_W }}>
              {pageBlocks.map((bi) => (
                <Fragment key={bi}>{renderBlock(blocks[bi])}</Fragment>
              ))}
            </div>
            <span className="ts-page-num">{pi + 1}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
