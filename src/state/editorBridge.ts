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
  // 大纲树拖动重排（Phase 12 Task 3）用的两个命令包装。两者对外都是同一种
  // "targetIndex 是原 doc.content 下标，插到当前排在这里的卡之前"的绝对语义
  // （跟 moveSection 命令本身一致，见 schema.ts 的注释），LeftNav 算落点时不用
  // 关心 moveCardTo 命令内部其实是 splice 语义——换算在这里做一次就够。
  moveCardTo: (cardIndex: number, targetIndex: number) => void
  moveSection: (headingCardIndex: number, targetIndex: number) => void
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
  // cardIndex 是被拖那张块卡在 doc.content 里的下标（== outlineTreeFromDoc 的
  // cardIndex，两者对同一份 doc 永远一一对应）。moveCardTo 命令本身收 cardId +
  // splice 下标（先摘掉这张卡、再在剩下那串卡里数下标），这里把外部的"绝对
  // 下标"语义转换成命令要的 splice 下标：目标排在被摘卡之后的话，摘掉一张后
  // 整体前移一位，要减一。
  moveCardTo: (cardIndex, targetIndex) => {
    const editor = get().editor
    if (!editor) return
    const doc = editor.state.doc
    if (cardIndex < 0 || cardIndex >= doc.childCount) return
    const cardId = doc.child(cardIndex).attrs.cardId
    if (!cardId) return
    const spliceIndex = targetIndex > cardIndex ? targetIndex - 1 : targetIndex
    editor.commands.moveCardTo(cardId, spliceIndex)
  },
  // 整段（章/节）搬家——直接转发给 moveSection 命令，它本身就是"绝对下标"语义。
  moveSection: (headingCardIndex, targetIndex) => {
    const editor = get().editor
    if (!editor) return
    editor.commands.moveSection(headingCardIndex, targetIndex)
  },
}))
