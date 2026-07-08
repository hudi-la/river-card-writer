import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { useBookStore } from '../state/bookStore'

export function CardView({ editor, getPos, node }: NodeViewProps) {
  const threadId: string | null = node.attrs.threadId
  const thread = useBookStore((s) => s.getThread(threadId))
  const style = thread ? ({ ['--thread' as any]: thread.color } as React.CSSProperties) : undefined
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
      </div>
      <NodeViewContent className="card-body" />
    </NodeViewWrapper>
  )
}
