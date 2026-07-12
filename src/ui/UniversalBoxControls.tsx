import { useRef, useState } from 'react'
import { useBookStore, UNIVERSAL_BOX_ID } from '../state/bookStore'
import { exportUniversalBox, parseUniversalExport } from '../state/backup'
import { downloadTextFile, todayStamp } from './download'

// 通用盒子自己的备份：跟整库备份分开，方便只想备份/搬运"跨书素材"的场景。导入
// 走 importUniversalCards（按 cardId 去重、只增不减，见 state/backup.ts 的
// mergeUniversalCards），重复导入同一份文件不会堆出重复卡。
//
// Phase 14 起支持多个通用盒子，但 importUniversalCards 这个 action 的语义没变
// （只增不减地合并进"默认那个"通用盒子，id===UNIVERSAL_BOX_ID，见 bookStore.ts）
// ——这个独立的单盒备份功能因此也只对默认盒子生效；新建的具名通用盒子走全库
// 备份（BackupControls，按盒子 id 合并，见 backup.ts 的 mergeUniversalBoxes）。
export function UniversalBoxControls() {
  const universalBox = useBookStore(
    (s) => s.library.universalBoxes.find((b) => b.id === UNIVERSAL_BOX_ID) ?? s.library.universalBoxes[0] ?? { id: UNIVERSAL_BOX_ID, name: '通用盒子', cards: [] }
  )
  const importUniversalCards = useBookStore((s) => s.importUniversalCards)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const json = exportUniversalBox(universalBox, new Date().toISOString())
    downloadTextFile(`card-writer-通用盒子-${todayStamp()}.json`, json)
    setMessage({ text: `已导出 ${universalBox.cards.length} 张卡` })
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一个文件
    if (!file) return
    const text = await file.text()
    const result = parseUniversalExport(text)
    if (!result.ok) {
      setMessage({ text: `导入失败：${result.error}`, error: true })
      return
    }
    importUniversalCards(result.cards)
    setMessage({ text: `导入了 ${result.cards.length} 张卡` })
  }

  return (
    <div className="backup-controls universal-box-controls">
      <button className="backup-btn" onClick={handleExport}>
        ⬇ 导出
      </button>
      <button className="backup-btn" onClick={handleImportClick}>
        ⬆ 导入
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="backup-file-input"
        onChange={handleFileChosen}
      />
      {message && <span className={message.error ? 'backup-msg backup-msg-error' : 'backup-msg'}>{message.text}</span>}
    </div>
  )
}
