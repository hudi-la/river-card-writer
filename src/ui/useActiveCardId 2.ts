import { useEffect, useState } from 'react'
import { useEditorBridge } from '../state/editorBridge'

// 光标此刻在哪张卡里。备料边栏据此决定显示哪一条卡的提词。
// 自己挂 selectionUpdate/transaction 监听而不是往 editorBridge 里加状态——这只是
// 一个视图关心的派生值，没必要进全局 store，也就不会有别处误改它的可能。
export function useActiveCardId(): string | null {
  const editor = useEditorBridge((s) => s.editor)
  const [cardId, setCardId] = useState<string | null>(null)

  useEffect(() => {
    if (!editor) {
      setCardId(null)
      return
    }
    const read = () => {
      const { $from } = editor.state.selection
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'card') {
          setCardId($from.node(d).attrs.cardId ?? null)
          return
        }
      }
      setCardId(null)
    }
    read()
    // transaction 也要听：文档结构变了（切卡/搬卡）之后光标所在的卡可能换了身份。
    editor.on('selectionUpdate', read)
    editor.on('transaction', read)
    return () => {
      editor.off('selectionUpdate', read)
      editor.off('transaction', read)
    }
  }, [editor])

  return cardId
}
