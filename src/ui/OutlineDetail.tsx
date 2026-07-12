import { useRef } from 'react'
import { useBookStore } from '../state/bookStore'
import { useEditorBridge } from '../state/editorBridge'
import {
  outlineTreeFromDoc,
  visibleOutlineRows,
  outlineRowHasDescendants,
  outlineCardClassName,
  outlineCardTitleTextClassName,
  outlineRowStyle,
  NoteField,
  OutlineCollapseTriangle,
  OutlineDragHandle,
  useOutlineRowDrag,
  scrollToOutlineIndex,
  scrollToCardIndex,
  type OutlineRow,
} from './LeftNav'

// 详细大纲（Phase 14 Task 2）：从 LeftNav 里搬出来的"每行标题/块 + 可编辑说明
// 框"视图，现在只活在悬浮大窗（Modal）里——侧栏永远只显示简略树。数据仍然
// 直接读 store 的 book.doc（不接收 props），跟 LeftNav 各读各的，两边永远
// 反映同一份文档，编辑/拖拽都立刻互相可见（同一个 doc，同一条 editorBridge）。
//
// 拖动重排复用跟侧栏简略树同一个 useOutlineRowDrag hook——只是挂在这个组件
// 自己的容器（.outline-detail）上，不需要 hover 便签相关的 onDragStart。
export function OutlineDetail() {
  const book = useBookStore((s) => s.activeBook())
  const openDoc = useBookStore((s) => s.openDoc)
  const setHeadingNote = useEditorBridge((s) => s.setHeadingNote)
  const setCardNote = useEditorBridge((s) => s.setCardNote)
  const addChapter = useEditorBridge((s) => s.addChapter)
  const bridgeMoveCardTo = useEditorBridge((s) => s.moveCardTo)
  const bridgeMoveSection = useEditorBridge((s) => s.moveSection)
  const bridgeToggleCollapsed = useEditorBridge((s) => s.toggleCollapsed)

  const rows = outlineTreeFromDoc(book?.doc)
  const visibleRows = visibleOutlineRows(rows)
  // 同 LeftNav：拖拽 effect 里要读"当下"的 rows，用 ref 兜底避免闭包过期。
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  let headingCounter = -1
  const headingIndices = rows.map((r) => (r.kind === 'heading' ? ++headingCounter : -1))
  const hasHeadings = headingCounter >= 0

  const containerRef = useRef<HTMLDivElement | null>(null)
  useOutlineRowDrag({
    containerRef,
    rowsRef,
    moveSection: bridgeMoveSection,
    moveCardTo: bridgeMoveCardTo,
    openDoc,
  })

  const handleRowClick = (row: OutlineRow, headingIndex: number) => {
    openDoc()
    // 大窗打开时正文可能还没挂载（比如刚从盒子视图切回），跟 LeftNav 的
    // handleRowClick 一样让这次 state 更新先跑完再滚动。
    setTimeout(() => {
      if (row.kind === 'heading') scrollToOutlineIndex(headingIndex)
      else scrollToCardIndex(row.cardIndex)
    }, 0)
  }

  const saveRowNote = (row: OutlineRow, headingIndex: number, value: string) => {
    if (row.kind === 'heading') setHeadingNote(headingIndex, value)
    else setCardNote(row.cardIndex, value)
  }

  return (
    <div className="outline-detail" ref={(el) => { containerRef.current = el }}>
      {!hasHeadings ? (
        <>
          <p className="outline-hint">还没有章节标题</p>
          <div className="add" onClick={() => addChapter()}>
            ＋ 新章节
          </div>
        </>
      ) : (
        <>
          {visibleRows.map(({ row, index: i }) => (
            <div
              key={row.cardIndex}
              className={outlineCardClassName(row)}
              data-outline-row-index={i}
              data-outline-kind={row.kind}
              data-row-color={row.bg}
              style={outlineRowStyle(row)}
            >
              <div className="outline-card-title" onClick={() => handleRowClick(row, headingIndices[i])}>
                {row.kind === 'heading' && (
                  <OutlineCollapseTriangle
                    row={row}
                    hasDescendants={outlineRowHasDescendants(rows, i)}
                    onToggle={() => bridgeToggleCollapsed(row.cardIndex)}
                  />
                )}
                <span className={outlineCardTitleTextClassName(row)}>
                  {row.kind === 'heading' ? row.text || '（无标题）' : row.preview || '（空块）'}
                </span>
                {row.kind === 'heading' && row.collapsed && (
                  <span className="outline-collapsed-marker" aria-hidden="true">⋯</span>
                )}
                <OutlineDragHandle />
              </div>
              <NoteField
                className="outline-card-note"
                placeholder="写点说明…"
                rows={2}
                initial={row.note}
                onSave={(value) => saveRowNote(row, headingIndices[i], value)}
              />
            </div>
          ))}
          <div className="add" onClick={() => addChapter()}>
            ＋ 新章节
          </div>
        </>
      )}
    </div>
  )
}
