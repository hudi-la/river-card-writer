import { create } from 'zustand'
import type { Editor } from '@tiptap/core'
import { findCardInDoc } from '../editor/schema'
import { useBookStore } from './bookStore'

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
  // 目录三角折叠（Phase 13 Task 2）——headingCardIndex 同 moveSection，是标题卡在
  // doc.content 里的下标，直接转发给 toggleCollapsed 命令（schema.ts 里定位它的
  // heading 段落、翻转 collapsed 属性）。
  toggleCollapsed: (headingCardIndex: number) => void
  // 大纲块行拖到盒子（"park"）——镜像 RiverEditor.tsx 里正文卡片拖到盒子的
  // finishDrag 逻辑（先落袋、后摘除，含只剩一张卡的边界情况），入口从"哪张卡的
  // DOM"换成"doc.content 第 cardIndex 张卡"。见下方实现的注释。
  parkOutlineCardToBox: (cardIndex: number, boxId: string) => boolean
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
  toggleCollapsed: (headingCardIndex) => {
    const editor = get().editor
    if (!editor) return
    editor.commands.toggleCollapsed(headingCardIndex)
  },
  // 数据安全铁律：先落袋（parkCard 把卡的 JSON 写进盒子），再从文档摘除——任何
  // 一步失败，卡最坏也只是"两边都有"或"哪边都没动"，绝不会出现"从文档消失但
  // 没进盒子"的悬空态。逻辑原样照抄 RiverEditor.tsx 的 finishDrag box-drop 分支
  // （唯一区别：那边先用 DOM ⠿ 拖出 cardId，这里直接用 doc.content 的下标）：
  //   - 文档里不止这一张卡：先 removeCard()，成功了再 parkCard()——多卡时
  //     removeCard 本身不会因为"文档不能空"而拒绝，正常先摘后放。
  //   - 文档里只剩这一张卡：removeCard 会拒绝（文档不能空），所以反过来先
  //     parkCard()（内容先安全存进盒子），再 appendCard() 撑住"文档非空"这条
  //     不变量，最后再把原卡摘掉——全程卡的内容至少在文档或盒子之一，从不悬空。
  parkOutlineCardToBox: (cardIndex, boxId) => {
    const editor = get().editor
    if (!editor) return false
    const doc = editor.state.doc
    if (cardIndex < 0 || cardIndex >= doc.childCount) return false
    const node = doc.child(cardIndex)
    const cardId: string | undefined = node.attrs.cardId
    if (!cardId) return false
    const found = findCardInDoc(doc, cardId)
    if (!found) return false
    const json = found.node.toJSON()
    const parkCard = useBookStore.getState().parkCard
    if (doc.childCount > 1) {
      const removed = editor.chain().focus().setTextSelection(found.pos + 2).removeCard().run()
      if (!removed) return false
      parkCard(boxId, json)
      return true
    }
    // 只剩这一张卡：先落袋，追加一张空卡撑住"文档非空"，再摘掉原卡。
    parkCard(boxId, json)
    editor.commands.appendCard()
    const again = findCardInDoc(editor.state.doc, cardId)
    if (again) editor.chain().focus().setTextSelection(again.pos + 2).removeCard().run()
    return true
  },
}))
