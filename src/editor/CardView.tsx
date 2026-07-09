import { useState } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { useBookStore } from '../state/bookStore'

export function CardView({ editor, getPos, node }: NodeViewProps) {
  const threadId: string | null = node.attrs.threadId
  const thread = useBookStore((s) => s.getThread(threadId))
  const threads = useBookStore((s) => s.book.threads)
  const addThread = useBookStore((s) => s.addThread)
  const boxes = useBookStore((s) => s.book.boxes)
  const addBox = useBookStore((s) => s.addBox)
  const parkCard = useBookStore((s) => s.parkCard)
  const style = thread ? ({ ['--thread' as any]: thread.color } as React.CSSProperties) : undefined
  const [menuOpen, setMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [boxMenuOpen, setBoxMenuOpen] = useState(false)

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
    <NodeViewWrapper as="section" className="card" data-thread-id={threadId || undefined} style={style}>
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
        <button
          data-card-ctrl="thread"
          title="选择线"
          onMouseDown={toggleMenu}
          style={{ color: thread ? thread.color : undefined }}
        >
          ●
        </button>
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
      <NodeViewContent className="card-body" />
    </NodeViewWrapper>
  )
}
