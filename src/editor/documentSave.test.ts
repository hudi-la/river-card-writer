import { beforeEach, expect, it } from 'vitest'
import { useBookStore } from '../state/bookStore'
import { commitEditorDocument } from './documentSave'
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }] })
beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })
it('a delayed editor callback cannot write into a newly selected book', () => {
 const s = useBookStore.getState(); const a = s.addBook('A'); const b = s.addBook('B'); s.openBook(b.id)
 expect(commitEditorDocument(a.id, a.doc, doc('A delayed content'))).toBe(false)
 expect(useBookStore.getState().activeBook()!.doc).toEqual(b.doc)
})
it('a transaction based on an older document preserves both revisions instead of replacing the newer one', () => {
 const s = useBookStore.getState(); const a = s.addBook('A'); s.openBook(a.id); s.updateDoc(doc('new remote revision'))
 expect(commitEditorDocument(a.id, a.doc, doc('stale editor typing'))).toBe(false)
 const latest = useBookStore.getState()
 expect(JSON.stringify(latest.activeBook()!.doc)).toContain('new remote revision')
 expect(latest.library.books.some(b => b.title.includes('未合并编辑') && JSON.stringify(b.doc).includes('stale editor typing'))).toBe(true)
})
it('normal editing of the current revision stays in the original manuscript', () => {
 const s = useBookStore.getState(); const a = s.addBook('A'); s.openBook(a.id)
 const count = useBookStore.getState().library.books.length
 expect(commitEditorDocument(a.id, a.doc, doc('current edit'))).toBe(true)
 expect(useBookStore.getState().library.books.length).toBe(count)
 expect(JSON.stringify(useBookStore.getState().activeBook()!.doc)).toContain('current edit')
})
