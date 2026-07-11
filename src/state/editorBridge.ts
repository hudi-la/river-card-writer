import { create } from 'zustand'
import type { Editor } from '@tiptap/core'

// 让不在编辑器树里的组件（比如左栏 sidebar 的 note 编辑框）也能拿到当前挂载的
// TipTap Editor 实例、发命令过去。RiverEditor 挂载时 setEditor(editor)，卸载
// 时 setEditor(null)——所以任何时候调用 setHeadingNote 前都要判空。
type EditorBridgeState = {
  editor: Editor | null
  setEditor: (editor: Editor | null) => void
  setHeadingNote: (headingIndex: number, note: string) => void
  setCardNote: (cardIndex: number, note: string) => void
  addChapter: () => void
}

export const useEditorBridge = create<EditorBridgeState>((set, get) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
  setHeadingNote: (headingIndex, note) => {
    const editor = get().editor
    if (!editor) return
    editor.commands.setHeadingNote(headingIndex, note)
  },
  // 大纲树（Phase 12 Task 2）里"块"行的说明——落到该卡的 note 属性，跟标题
  // note 走同一条"editorBridge 是唯一改 doc 的路"的规矩。
  setCardNote: (cardIndex, note) => {
    const editor = get().editor
    if (!editor) return
    editor.commands.setCardNote(cardIndex, note)
  },
  // "＋ 新章节"：空书/已有章节都走这个——在文档末尾插入一张空 chapter 段落的卡，
  // 聚焦进去，用户能立刻打字。outline 是从 doc 派生的，插入后自然多一条目录项。
  addChapter: () => {
    const editor = get().editor
    if (!editor) return
    editor.chain().focus().addChapterHeading().run()
  },
}))
