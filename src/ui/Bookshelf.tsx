import { useState } from 'react'
import { useBookStore, type Book } from '../state/bookStore'

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

function BookCard({ book }: { book: Book }) {
  const openBook = useBookStore((s) => s.openBook)
  const renameBook = useBookStore((s) => s.renameBook)
  const deleteBook = useBookStore((s) => s.deleteBook)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(book.title)

  const commitRename = () => {
    const title = draft.trim()
    if (title && title !== book.title) renameBook(book.id, title)
    setEditing(false)
  }

  return (
    <div className="book-card" onClick={() => !editing && openBook(book.id)}>
      <div className="book-cover" style={{ backgroundImage: coverGradient(book.id) }} />
      <button
        className="book-delete"
        aria-label="删除这本书"
        onClick={(e) => {
          e.stopPropagation()
          if (window.confirm(`删除《${book.title}》？此操作不可撤销。`)) deleteBook(book.id)
        }}
      >
        ×
      </button>
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

export function Bookshelf() {
  const books = useBookStore((s) => s.library.books)
  const addBook = useBookStore((s) => s.addBook)
  const openBook = useBookStore((s) => s.openBook)

  return (
    <div className="shelf">
      {books.length === 0 ? (
        <p className="shelf-hint">书柜还是空的，点下面「＋ 新书」开始写第一本</p>
      ) : (
        <div className="shelf-grid">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
      <div
        className="shelf-add"
        onClick={() => {
          const book = addBook()
          openBook(book.id)
        }}
      >
        ＋ 新书
      </div>
    </div>
  )
}
