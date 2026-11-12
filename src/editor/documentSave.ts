import { useBookStore } from '../state/bookStore'
import { useToastStore } from '../state/toastStore'

// Every editor transaction belongs to the book AND document it was based on.
// A delayed transaction must never overwrite a different book or remote revision.
export function commitEditorDocument(bookId: string | undefined, base: unknown, doc: any): boolean {
  const state = useBookStore.getState()
  const current = state.activeBook()
  if (!bookId || current?.id !== bookId) return false
  if (current.doc !== base && JSON.stringify(current.doc) !== JSON.stringify(base)) {
    if (JSON.stringify(doc) !== JSON.stringify(current.doc)) {
      const copy = { ...current, id: crypto.randomUUID(), title: `${current.title} · 未合并编辑`, doc, updatedAt: new Date().toISOString() }
      state.setLibrary({ ...state.library, books: [...state.library.books, copy] })
      useToastStore.getState().show({ text: '正文已有新版本。刚才的编辑已另存为“未合并编辑”，两份内容都保留。', kind: 'info', durationMs: 10000 })
    }
    return false
  }
  state.updateDoc(doc)
  return true
}
