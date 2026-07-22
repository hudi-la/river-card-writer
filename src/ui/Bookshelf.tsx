import { useState } from 'react'
import { Plus, Palette, Trash2, Download } from 'lucide-react'
import { useBookStore, isValidCover, type Book, type Box } from '../state/bookStore'
import { BackupControls } from './BackupControls'
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
  // 有自定义封面、且没被明确关掉纹理时才叠加那层细纹理；自动渐变封面维持老样子
  // （一直都带纹理），不需要额外判断。
  const hasTexture = !isValidCover(book.cover) || book.cover.texture !== false

  const commitRename = () => {
    const title = draft.trim()
    if (title && title !== book.title) renameBook(book.id, title)
    setEditing(false)
  }

  const handleExportBook = (e: React.MouseEvent) => {
    e.stopPropagation()
    const json = exportBook(book, new Date().toISOString())
    downloadTextFile(`card-writer-${sanitizeFilename(book.title)}-${todayStamp()}.json`, json)
  }

  return (
    <div className="book-card" onClick={() => !editing && openBook(book.id)}>
      <div
        className={`book-cover${hasTexture ? '' : ' book-cover--no-texture'}`}
        style={{ backgroundImage: coverBackground(book) }}
      >
        {/* 贴底居中的封面编辑按钮必须嵌在 .book-cover 内部（不是跟它平级的
            .book-card 子元素）——.book-card 还包着下面的书名文字，"bottom:8px"
            要是相对 .book-card 算，会落到书名边上而不是封面底部。 */}
        <button
          className="book-cover-edit"
          aria-label="编辑封面"
          title="编辑封面"
          onClick={(e) => {
            e.stopPropagation()
            setCoverEditorOpen(true)
          }}
        >
          <Palette size={13} strokeWidth={1.75} aria-hidden="true" />
          封面
        </button>
      </div>
      <button className="book-export" aria-label="导出这本书" title="导出这本书" onClick={handleExportBook}>
        <Download size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        className="book-delete"
        aria-label="删除这本书"
        onClick={(e) => {
          e.stopPropagation()
          if (window.confirm(`删除《${book.title}》？此操作不可撤销。`)) deleteBook(book.id)
        }}
      >
        <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>
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

// 书柜里的一个通用盒子瓦片：跟书卡同宽、正方形，画面是"一个盒子里立着几张卡片"，
// 一眼看出它是装卡片的容器。名字+张数在下面，双击名字改名（跟 BookCard 同手感）。
function UniversalBoxTile({ box, onOpen }: { box: Box; onOpen: (id: string) => void }) {
  const renameUniversalBox = useBookStore((s) => s.renameUniversalBox)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(box.name)

  const commitRename = () => {
    const name = draft.trim()
    if (name && name !== box.name) renameUniversalBox(box.id, name)
    setEditing(false)
  }

  return (
    <div className="box-tile" onClick={() => !editing && onOpen(box.id)}>
      <div className="box-face" aria-hidden="true">
        <div className="box-cards">
          <i />
          <i />
          <i />
        </div>
        <div className="box-front" />
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
      <UserCenter />
      <BackupControls />
      <div className="shelf-grid">
        <ShelfAddBookTile />
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
      {books.length === 0 && <p className="shelf-hint">书柜还是空的，点上面「＋ 新书」开始写第一本</p>}
      <div className="shelf-divider" aria-hidden="true" />
      <UniversalBoxSection onOpen={setOpenUniversalBoxId} />
      <UniversalBoxModal boxId={openUniversalBoxId} onClose={() => setOpenUniversalBoxId(null)} readOnly />
    </div>
  )
}
