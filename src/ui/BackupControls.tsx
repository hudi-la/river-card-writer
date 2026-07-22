import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useBookStore } from '../state/bookStore'
import { exportLibrary, parseBackup, mergeUniversalBoxes } from '../state/backup'
import { downloadTextFile, todayStamp } from './download'

// 用户完全掌控的本地备份：导出全部书到一个 JSON 文件，导入时只增不减地并入书柜
// （合并逻辑见 state/backup.ts 的 mergeImported，id 撞车会给导入书换新 id，绝不
// 覆盖/丢弃现有的书）。这是"永不丢失用户的书"这条硬规则的最后一道保险。
export function BackupControls() {
  const library = useBookStore((s) => s.library)
  const importBooks = useBookStore((s) => s.importBooks)
  const setLibrary = useBookStore((s) => s.setLibrary)
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
    // 老备份文件（Phase 11 之前导出的）没有 universalBoxes 字段——result.universalBoxes
    // 缺失时就跳过这一步，不当错误处理。按 id 合并每个通用盒子、按 cardId 去重
    // 合并卡片（见 backup.ts 的 mergeUniversalBoxes）——不属于 importBooks 的合并
    // 范围，单独用 setLibrary 落一次盘（setLibrary 会原样采纳合法的
    // universalBoxes 数组，见 bookStore.ts）。
    let suffix = ''
    if (result.universalBoxes) {
      const cur = useBookStore.getState().library
      const universalBoxes = mergeUniversalBoxes(cur.universalBoxes, result.universalBoxes)
      setLibrary({ ...cur, universalBoxes })
      const totalCards = result.universalBoxes.reduce((n, b) => n + b.cards.length, 0)
      suffix = `，${result.universalBoxes.length} 个通用盒子共 ${totalCards} 张卡已合并`
    }
    setMessage({ text: `导入了 ${result.books.length} 本书${suffix}` })
  }

  return (
    <div className="backup-controls">
      <button className="backup-btn" onClick={handleExport}>
        <Download size={16} strokeWidth={1.75} aria-hidden="true" />
        导出备份
      </button>
      <button className="backup-btn" onClick={handleImportClick}>
        <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
        从备份导入
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
