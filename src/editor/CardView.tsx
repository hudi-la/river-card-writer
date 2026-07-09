import { useState } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { useBookStore, THREAD_PALETTE } from '../state/bookStore'
import { useDismiss } from '../ui/useDismiss'

// 没挂线的卡也要有一眼能分辨出来的浅色背景，稳定地由 cardId 哈希出来（同一张卡换位置
// 颜色不变，不同卡大概率不同），复用 THREAD_PALETTE 让整体调性统一。
function hashCardId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}
function autoColorFor(cardId: string | null): string {
  return THREAD_PALETTE[hashCardId(cardId ?? '') % THREAD_PALETTE.length]
}

const ROLE_ITEMS: { label: string; role: 'body' | 'heading' | 'quote' | 'note' }[] = [
  { label: '正文', role: 'body' },
  { label: '小标题', role: 'heading' },
  { label: '引文', role: 'quote' },
  { label: '旁注', role: 'note' },
]

export function CardView({ editor, getPos, node }: NodeViewProps) {
  const cardId: string | null = node.attrs.cardId
  const threadId: string | null = node.attrs.threadId
  const role: string = node.attrs.role || 'body'
  const thread = useBookStore((s) => s.getThread(threadId))
  const threads = useBookStore((s) => s.book.threads)
  const addThread = useBookStore((s) => s.addThread)
  const boxes = useBookStore((s) => s.book.boxes)
  const addBox = useBookStore((s) => s.addBox)
  const parkCard = useBookStore((s) => s.parkCard)
  // 挂了线：用线色，同线的卡连成一条带（不变）。没挂线：自动配一个稳定的浅色，
  // 让每张卡默认就能一眼分辨——两者复用同一个 --thread 变量，CSS 只按
  // data-thread-id / data-auto-color 二选一取不同的透明度。
  const style = ({ ['--thread' as any]: thread ? thread.color : autoColorFor(cardId) } as React.CSSProperties)
  const [menuOpen, setMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [boxMenuOpen, setBoxMenuOpen] = useState(false)
  const [roleMenuOpen, setRoleMenuOpen] = useState(false)

  const threadPopRef = useDismiss<HTMLDivElement>(menuOpen, () => {
    setMenuOpen(false)
    setCreating(false)
    setName('')
  })
  const boxPopRef = useDismiss<HTMLDivElement>(boxMenuOpen, () => setBoxMenuOpen(false))
  const rolePopRef = useDismiss<HTMLDivElement>(roleMenuOpen, () => setRoleMenuOpen(false))

  const run = (cmd: 'up' | 'down' | 'add' | 'merge') => (e: React.MouseEvent) => {
    e.preventDefault()
    const pos = getPos()
    if (typeof pos !== 'number') return
    const chain = editor.chain().focus().setTextSelection(pos + 2)
    if (cmd === 'up') chain.moveCardUp().run()
    else if (cmd === 'down') chain.moveCardDown().run()
    else if (cmd === 'add') chain.insertCardAfter().run()
    else chain.mergeCardBackward().run()
  }

  const assign = (id: string | null) => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor.chain().focus().setTextSelection(pos + 2).setCardThread(id).run()
    setMenuOpen(false)
    setCreating(false)
    setName('')
  }

  const toggleMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenuOpen((o) => !o)
    setCreating(false)
  }

  const toggleBoxMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setBoxMenuOpen((o) => !o)
  }

  const parkInto = (boxId: string) => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const json = editor.state.doc.nodeAt(pos)?.toJSON()
    if (!json) return
    // Only park into the box if the river removal actually succeeds — removeCard
    // refuses to remove the last card in a chapter, so don't create a duplicate.
    const removed = editor.chain().focus().setTextSelection(pos + 2).removeCard().run()
    if (removed) parkCard(boxId, json)
    setBoxMenuOpen(false)
  }

  const parkIntoNewBox = () => {
    const box = addBox('新盒子')
    parkInto(box.id)
  }

  const toggleRoleMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setRoleMenuOpen((o) => !o)
  }

  const assignRole = (r: 'body' | 'heading' | 'quote' | 'note') => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor.chain().focus().setTextSelection(pos + 2).setCardRole(r).run()
    setRoleMenuOpen(false)
  }

  const startCreate = (e: React.MouseEvent) => {
    e.preventDefault()
    setCreating(true)
  }

  const confirmCreate = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const trimmed = name.trim()
    if (!trimmed) return
    const t = addThread(trimmed)
    assign(t.id)
  }

  const isFirst = typeof getPos() === 'number' && getPos() === 0
  return (
    <NodeViewWrapper
      as="section"
      className="card"
      data-card-id={cardId || undefined}
      data-thread-id={threadId || undefined}
      data-auto-color={threadId ? undefined : true}
      data-role={role}
      style={style}
    >
      <div className="card-ctrls" contentEditable={false}>
        <button data-card-ctrl="up" title="上移" disabled={isFirst} onMouseDown={run('up')}>
          ▲
        </button>
        <button data-card-ctrl="down" title="下移" onMouseDown={run('down')}>
          ▼
        </button>
        <button data-card-ctrl="add" title="在此后加一张卡" onMouseDown={run('add')}>
          ＋
        </button>
        <button data-card-ctrl="merge" title="合并进上一张" disabled={isFirst} onMouseDown={run('merge')}>
          ✕
        </button>
        <div className="ctrl-pop" ref={threadPopRef}>
          <button
            data-card-ctrl="thread"
            title="选择线"
            onMouseDown={toggleMenu}
            style={{ color: thread ? thread.color : undefined }}
          >
            ●
          </button>
          {menuOpen && (
            <div className="thread-menu" contentEditable={false}>
              {threads.map((t) => (
                <button key={t.id} onMouseDown={(e) => { e.preventDefault(); assign(t.id) }}>
                  <span className="thread-dot" style={{ ['--dot' as any]: t.color }} />
                  {t.name}
                </button>
              ))}
              <button onMouseDown={(e) => { e.preventDefault(); assign(null) }}>去色</button>
              {!creating ? (
                <button onMouseDown={startCreate}>＋ 新建线</button>
              ) : (
                <input
                  autoFocus
                  value={name}
                  placeholder="线名"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={confirmCreate}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              )}
            </div>
          )}
        </div>
        <div className="ctrl-pop" ref={boxPopRef}>
          <button data-card-ctrl="tobox" title="收进盒子" onMouseDown={toggleBoxMenu}>
            ⇢
          </button>
          {boxMenuOpen && (
            <div className="box-menu" contentEditable={false}>
              {boxes.map((b) => (
                <button key={b.id} onMouseDown={(e) => { e.preventDefault(); parkInto(b.id) }}>
                  {b.name}
                </button>
              ))}
              <button onMouseDown={(e) => { e.preventDefault(); parkIntoNewBox() }}>＋新盒子</button>
            </div>
          )}
        </div>
        <div className="ctrl-pop" ref={rolePopRef}>
          <button data-card-ctrl="role" title="选择样式" onMouseDown={toggleRoleMenu}>
            Aa
          </button>
          {roleMenuOpen && (
            <div className="role-menu" contentEditable={false}>
              {ROLE_ITEMS.map((item) => (
                <button
                  key={item.role}
                  className={role === item.role ? 'on' : undefined}
                  onMouseDown={(e) => { e.preventDefault(); assignRole(item.role) }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <NodeViewContent className="card-body" />
    </NodeViewWrapper>
  )
}
