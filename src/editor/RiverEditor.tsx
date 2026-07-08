import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

const HANDLE_ZONE_PX = 28 // .card 左内边距 40px 里，把手落在最左侧这一段

export function RiverEditor({ chapterId }: { chapterId: string }) {
  const chapter = useBookStore((s) => s.book.chapters.find((c) => c.id === chapterId))!
  const updateChapterDoc = useBookStore((s) => s.updateChapterDoc)
  const dragStart = useRef<{ y: number; card: HTMLElement } | null>(null)

  const editor = useEditor({
    extensions: baseExtensions,
    content: chapter.doc,
    immediatelyRender: false,
    onUpdate: ({ editor }) => updateChapterDoc(chapterId, editor.getJSON()),
    editorProps: { attributes: { class: 'river' } },
  })

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement

    const onPointerDown = (e: PointerEvent) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.card')
      if (!card) return
      const rect = card.getBoundingClientRect()
      // 把手渲染在 card 左侧 ::after（约 14px~26px 处），只在这段区域内响应
      if (e.clientX - rect.left > HANDLE_ZONE_PX) return
      dragStart.current = { y: e.clientY, card }
      // 把选区挪到抓取的这张 card 里，这样 pointerup 时 moveCardUp/Down 操作的是它，
      // 而不是原本光标所在的那张 card
      try {
        const pos = editor.view.posAtDOM(card, 0)
        editor.commands.setTextSelection(pos + 1)
      } catch {
        // card 未挂载到编辑器 DOM 时忽略
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const start = dragStart.current
      dragStart.current = null
      if (!start) return
      const dy = e.clientY - start.y
      if (Math.abs(dy) < 4) return
      if (dy < 0) editor.commands.moveCardUp()
      else editor.commands.moveCardDown()
    }

    dom.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [editor])

  if (!editor) return null
  return <EditorContent editor={editor} />
}
