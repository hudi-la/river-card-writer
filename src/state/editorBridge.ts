import { create } from 'zustand'
import type { Editor } from '@tiptap/core'

// 让不在编辑器树里的组件（比如左栏 sidebar 的 note 编辑框）也能拿到当前挂载的
// TipTap Editor 实例、发命令过去。RiverEditor 挂载时 setEditor(editor)，卸载
// 时 setEditor(null)——所以任何时候调用 setHeadingNote 前都要判空。
type EditorBridgeState = {
  editor: Editor | null
  setEditor: (editor: Editor | null) => void
  setHeadingNote: (headingIndex: number, note: string) => void
}

export const useEditorBridge = create<EditorBridgeState>((set, get) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
  setHeadingNote: (headingIndex, note) => {
    const editor = get().editor
    if (!editor) return
    editor.commands.setHeadingNote(headingIndex, note)
  },
}))
