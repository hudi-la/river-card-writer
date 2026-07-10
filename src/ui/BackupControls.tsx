import { useRef, useState } from 'react'
import { useBookStore } from '../state/bookStore'
import { exportLibrary, parseBackup } from '../state/backup'
import { downloadTextFile, todayStamp } from './download'

// 用户完全掌控的本地备份：导出全部书到一个 JSON 文件，导入时只增不减地并入书柜
// （合并逻辑见 state/backup.ts 的 mergeImported，id 撞车会给导入书换新 id，绝不
// 覆盖/丢弃现有的书）。这是"永不丢失用户的书"这条硬规则的最后一道保险。
export function BackupControls() {
  const library = useBookStore((s) => s.library)
  const importBooks = useBookStore((s) => s.importBooks)
  const importUniversalCards = useBookStore((s) => s.importUniversalCards)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const json = exportLibrary(library, new Date().toISOString())
    downloadTextFile(`card-writer-备份-${todayStamp()}.json`, json)
    setMessage({ text: `已导出 ${library.books.length} 本书` })
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一个文件
    if (!file) return
    const text = await file.text()
    const result = parseBackup(text)
    if (!result.ok) {
      setMessage({ text: `导入失败：${result.error}`, error: true })
      return
    }
    importBooks(result.books)
    // 老备份文件（Phase 11 之前导出的）没有 universalBox 字段——result.universalBox
    // 缺失时就跳过这一步，不当错误处理。
    if (result.universalBox) importUniversalCards(result.universalBox.cards)
    const suffix = result.universalBox ? `，通用盒子 ${result.universalBox.cards.length} 张卡已合并` : ''
    setMessage({ text: `导入了 ${result.books.length} 本书${suffix}` })
  }

  return (
    <div className="backup-controls">
      <button className="backup-btn" onClick={handleExport}>
        ⬇ 导出备份
      </button>
      <button className="backup-btn" onClick={handleImportClick}>
        ⬆ 从备份导入
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
