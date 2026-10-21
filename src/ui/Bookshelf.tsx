import { ArticleExport } from './ArticleExport'
import { useState, useEffect, useRef } from 'react'
import { Plus, Palette, Trash2, Download, Smile, MoreHorizontal, Pencil, Info } from 'lucide-react'
import { useBookStore, isValidCover, type Book, type Box } from '../state/bookStore'
import { exportBook, sanitizeFilename } from '../state/backup'
import { downloadTextFile, todayStamp } from './download'
import { UniversalBoxModal } from './BoxView'
import { CoverEditorModal, coverToCss } from './CoverEditor'
import { UserCenter } from './UserCenter'

// 纯函数：书 id 哈希出两三个低饱和柔色，拼一个 linear-gradient 当封面——不碰真实
// 图片，呼应"纹理+三色渐变"的封面审美（具体纹理叠层在 CSS ::after 里统一加，不
// 需要 id 相关，保持这里纯粹只管配色）。同一个 id 每次都得到同一张封面。
export function coverGradient(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const hue1 = h % 360
  const hue2 = (hue1 + 40 + ((h >> 3) % 60)) % 360
  const hue3 = (hue1 + 160 + ((h >> 7) % 60)) % 360
  return `linear-gradient(135deg, hsl(${hue1} 38% 78%), hsl(${hue2} 32% 70%), hsl(${hue3} 30% 82%))`
}

// 封面背景：book.cover 存在就用它（三色渐变+可调角度），否则回退到老的自动哈希
// 渐变——这是唯一的分支，没设置过封面的书（老书、新建的书）表现跟改动前完全
// 一致。cover 形状万一是脏数据（比如导入了一份手改过的备份），isValidCover 兜
// 底，绝不因为渲染这一步炸掉整个书柜。
export function coverBackground(book: Book): string {
  if (isValidCover(book.cover)) return coverToCss(book.cover)
  return coverGradient(book.id)
}

function BookCard({ book }: { book: Book }) {
  const openBook = useBookStore((s) => s.openBook)
  const renameBook = useBookStore((s) => s.renameBook)
  const deleteBook = useBookStore((s) => s.deleteBook)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(book.title)
  const [coverEditorOpen, setCoverEditorOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // 有自定义封面、且没被明确关掉纹理时才叠加那层细纹理；自动渐变封面维持老样子
  // （一直都带纹理），不需要额外判断。
  const hasTexture = !isValidCover(book.cover) || book.cover.texture !== false

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('.modal-backdrop')) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const commitRename = () => {
    const title = draft.trim()
    if (title && title !== book.title) renameBook(book.id, title)
    setEditing(false)
  }

  const doExport = () => {
    const json = exportBook(book, new Date().toISOString())
    downloadTextFile(`card-writer-${sanitizeFilename(book.title)}-${todayStamp()}.json`, json)
  }

  return (
    <div className="book-card" onClick={() => !editing && !menuOpen && openBook(book.id)}>
      <div
        className={`book-cover${hasTexture ? '' : ' book-cover--no-texture'}`}
        style={{ backgroundImage: coverBackground(book) }}
      >
        {/* 右上角「⋯」菜单：合并 重命名 / 自定义封面 / 导出 / 删除。嵌在 .book-cover
            内部，绝对定位相对封面算，不会落到书名边上。 */}
        <button
          className="book-menu-btn"
          aria-label="更多"
          title="更多"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
        >
          <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="book-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button
              className="book-menu-item"
              onClick={() => {
                setMenuOpen(false)
                setDraft(book.title)
                setEditing(true)
              }}
            >
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> 重命名
            </button>
            <button
              className="book-menu-item"
              onClick={() => {
                setMenuOpen(false)
                setCoverEditorOpen(true)
              }}
            >
              <Palette size={14} strokeWidth={1.75} aria-hidden="true" /> 自定义封面
            </button>
            <button
              className="book-menu-item"
              onClick={() => {
                setMenuOpen(false)
                doExport()
              }}
            >
              <Download size={14} strokeWidth={1.75} aria-hidden="true" /> 导出备份
            </button>
            <ArticleExport book={book} menu />
            <button
              className="book-menu-item book-menu-danger"
              onClick={() => {
                setMenuOpen(false)
                if (window.confirm(`删除《${book.title}》？此操作不可撤销。`)) deleteBook(book.id)
              }}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /> 删除
            </button>
          </div>
        )}
      </div>
      <CoverEditorModal book={book} open={coverEditorOpen} onClose={() => setCoverEditorOpen(false)} />
      {editing ? (
        <input
          className="book-title-edit"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
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
        <p
          className="book-title"
          // 单击也要在这里挡住冒泡：原生 dblclick 序列会先派发两次 click（各自冒泡
          // 到卡片的 openBook），dblclick 才最后触发——等它触发时已经打开书了。
          // 挡住 click 意味着点标题不会开书，得点封面；双击标题才进入改名。
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setDraft(book.title)
            setEditing(true)
          }}
        >
          {book.title}
        </p>
      )}
    </div>
  )
}

// "＋ 新书" 挪到书卡旁边（Phase 14 Task 4 #7）：跟书卡同一个 `.shelf-grid`，同样
// 的卡片尺寸/圆角封面手感，只是虚线边框 + 一个大大的"＋"，一眼能看出是新建
// 而不是某本已有的书。永远排在第一格，书再多也不会被挤到看不见的地方。
function ShelfAddBookTile() {
  const addBook = useBookStore((s) => s.addBook)
  const openBook = useBookStore((s) => s.openBook)

  return (
    <div
      className="book-card shelf-add-book"
      onClick={() => {
        const book = addBook()
        openBook(book.id)
      }}
    >
      <div className="book-cover shelf-add-cover" aria-hidden="true">
        <Plus size={28} strokeWidth={1.75} />
      </div>
      <p className="book-title shelf-add-label">
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        新书
      </p>
    </div>
  )
}

const DEFAULT_BOX_EMOJI = '🗂️'
// 一组耐看的 emoji 供选盒子图标——够用就好，不做全量搜索的大 picker。
const BOX_EMOJIS = [
  '🗂️', '📦', '🗃️', '📁', '📚', '📝', '💡', '✨', '⭐', '🔥', '❤️', '🌱', '🍀', '🌸',
  '🌊', '🌙', '☀️', '🎯', '🧩', '🧠', '🎨', '🎵', '📌', '🔖', '🧵', '🪄', '🗺️', '🧭',
  '⚙️', '🔬', '🐚', '🦋', '🍂', '🏔️', '☕', '🕯️', '🎁', '🌈', '🐣', '🪺', '🍎', '🧪',
]

// 小 emoji 选择器：点盒子右上角的笑脸按钮弹出，点一个即设为盒子图标；点外面 / Esc 关闭。
function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('.modal-backdrop')) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div className="emoji-picker" ref={ref} onClick={(e) => e.stopPropagation()}>
      {BOX_EMOJIS.map((em) => (
        <button key={em} type="button" className="emoji-picker-item" onClick={() => onPick(em)}>
          {em}
        </button>
      ))}
    </div>
  )
}

// 一组柔色供盒子选底色（呼应卡片/封面那套低饱和调）。
const BOX_COLORS = ['#7fa3c4', '#8bad86', '#d8b46a', '#d98b7a', '#c98bb0', '#a98cc4', '#6bb0ad', '#9aa0a6']

// 小颜色选择器：一排色块 + 一个"默认"（清除）；点外面 / Esc 关闭。
function ColorPicker({ onPick, onClose }: { onPick: (c: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('.modal-backdrop')) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div className="color-picker" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="color-swatch color-swatch-none" title="默认" onClick={() => onPick('')} />
      {BOX_COLORS.map((c) => (
        <button key={c} type="button" className="color-swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />
      ))}
    </div>
  )
}

// 书柜里的一个通用盒子瓦片：跟书卡同宽、正方形，封面是一个 emoji（默认 🗂️，可像
// Notion 一样自己换）。名字+张数在下面，双击名字改名（跟 BookCard 同手感）。
function UniversalBoxTile({ box, onOpen }: { box: Box; onOpen: (id: string) => void }) {
  const renameUniversalBox = useBookStore((s) => s.renameUniversalBox)
  const setUniversalBoxEmoji = useBookStore((s) => s.setUniversalBoxEmoji)
  const setUniversalBoxColor = useBookStore((s) => s.setUniversalBoxColor)
  const deleteUniversalBox = useBookStore((s) => s.deleteUniversalBox)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(box.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const [picker, setPicker] = useState<null | 'emoji' | 'color'>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element)?.closest?.('.modal-backdrop')) return
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const commitRename = () => {
    const name = draft.trim()
    if (name && name !== box.name) renameUniversalBox(box.id, name)
    setEditing(false)
  }

  return (
    <div className="box-tile" onClick={() => !editing && !menuOpen && !picker && onOpen(box.id)}>
      <div className="box-face" style={box.color ? { background: `${box.color}2e` } : undefined}>
        <span className="box-emoji" aria-hidden="true">
          {box.emoji || DEFAULT_BOX_EMOJI}
        </span>
        <button
          className="box-menu-btn"
          title="更多"
          aria-label="更多"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
        >
          <MoreHorizontal size={15} strokeWidth={2} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className="book-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
            <button
              className="book-menu-item"
              onClick={() => {
                setMenuOpen(false)
                setDraft(box.name)
                setEditing(true)
              }}
            >
              <Pencil size={14} strokeWidth={1.75} aria-hidden="true" /> 重命名
            </button>
            <button className="book-menu-item" onClick={() => { setMenuOpen(false); setPicker('emoji') }}>
              <Smile size={14} strokeWidth={1.75} aria-hidden="true" /> 换 icon
            </button>
            <button className="book-menu-item" onClick={() => { setMenuOpen(false); setPicker('color') }}>
              <Palette size={14} strokeWidth={1.75} aria-hidden="true" /> 换颜色
            </button>
            <button
              className="book-menu-item book-menu-danger"
              onClick={() => {
                setMenuOpen(false)
                if (window.confirm(`删除盒子「${box.name}」？盒子里的卡片会一起删掉。`)) deleteUniversalBox(box.id)
              }}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /> 删除
            </button>
          </div>
        )}
        {picker === 'emoji' && (
          <EmojiPicker
            onPick={(em) => {
              setUniversalBoxEmoji(box.id, em)
              setPicker(null)
            }}
            onClose={() => setPicker(null)}
          />
        )}
        {picker === 'color' && (
          <ColorPicker
            onPick={(c) => {
              setUniversalBoxColor(box.id, c)
              setPicker(null)
            }}
            onClose={() => setPicker(null)}
          />
        )}
      </div>
      {editing ? (
        <input
          className="box-tile-name-edit"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              setDraft(box.name)
              setEditing(false)
            }
          }}
        />
      ) : (
        <p className="box-tile-name">
          <span
            className="box-tile-name-text"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setDraft(box.name)
              setEditing(true)
            }}
          >
            {box.name}
          </span>
          <span className="box-tile-count">{box.cards.length} 张</span>
        </p>
      )}
    </div>
  )
}

// "＋ 新通用盒子"瓦片：跟盒子瓦片同尺寸，虚线方框 + 大"＋"，永远排在最前面。
function UniversalBoxAddTile() {
  const addUniversalBox = useBookStore((s) => s.addUniversalBox)
  return (
    <div className="box-tile box-tile-add" onClick={() => addUniversalBox('通用盒子')}>
      <div className="box-face box-face-add" aria-hidden="true">
        <Plus size={26} strokeWidth={1.75} />
      </div>
      <p className="box-tile-name box-tile-add-label">
        <Plus size={13} strokeWidth={1.75} aria-hidden="true" />
        新通用盒子
      </p>
    </div>
  )
}

// 所有通用盒子：跟书一样铺在网格里（同宽），"＋ 新通用盒子"排最前面。
function UniversalBoxSection({ onOpen }: { onOpen: (id: string) => void }) {
  const universalBoxes = useBookStore((s) => s.library.universalBoxes)
  return (
    <div className="shelf-grid">
      <UniversalBoxAddTile />
      {universalBoxes.map((box) => (
        <UniversalBoxTile key={box.id} box={box} onOpen={onOpen} />
      ))}
    </div>
  )
}

export function Bookshelf() {
  const books = useBookStore((s) => s.library.books)
  // 从书柜打开的通用盒子没有当前 doc（readOnly），Modal 本身跟 LeftNav 里书内
  // 打开的是同一个 UniversalBoxModal 组件，只是各自管各自的"当前开着哪个"状态。
  const [openUniversalBoxId, setOpenUniversalBoxId] = useState<string | null>(null)

  return (
    <div className="shelf">
      {/* 头部：川 logo + 大标题 River + 中文副标（左）、头像/登录（右），对齐读书 app 的 Library 排版骨架，浅色。 */}
      <div className="shelf-top">
        <div className="shelf-lockup">
          {/* 川：三道水流，三色各一股（蓝·绿·金），呼应彩色卡片。 */}
          <svg className="shelf-logo" viewBox="0 0 48 48" role="img" aria-label="川 River">
            <path d="M15 10 C 12 20, 18 28, 14 38" fill="none" stroke="#7fa3c4" strokeWidth="5" strokeLinecap="round" />
            <path d="M24 9 C 21 19, 27 29, 24 39" fill="none" stroke="#8bad86" strokeWidth="5" strokeLinecap="round" />
            <path d="M33 10 C 30 20, 36 28, 33 38" fill="none" stroke="#d8b46a" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <div className="shelf-brand">
            <h1 className="shelf-title">River</h1>
            <p className="shelf-subtitle">卡片河流写作</p>
          </div>
        </div>
        <UserCenter />
      </div>

      {/* 栏目一：正在写的书 */}
      <section className="shelf-section">
        <h2 className="shelf-section-title">正在写的书</h2>
        <div className="shelf-grid">
          <ShelfAddBookTile />
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
        {books.length === 0 && <p className="shelf-hint">书柜还是空的，点上面「＋ 新书」开始写第一本</p>}
      </section>

      {/* 栏目二：通用盒子。标题后跟一个安静的 ⓘ，悬停/聚焦才提示"可在每本书中访问"。 */}
      <section className="shelf-section">
        <h2 className="shelf-section-title">
          通用盒子
          <span className="shelf-section-info" title="可在每本书中访问" tabIndex={0} role="note" aria-label="可在每本书中访问">
            <Info size={14} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </h2>
        <UniversalBoxSection onOpen={setOpenUniversalBoxId} />
      </section>

      <UniversalBoxModal boxId={openUniversalBoxId} onClose={() => setOpenUniversalBoxId(null)} readOnly />
    </div>
  )
}
