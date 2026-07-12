import { useRef, useState } from 'react'
import { useBookStore } from '../state/bookStore'
import { exportLibrary, parseBackup, mergeUniversalBoxes } from '../state/backup'
import { downloadTextFile, todayStamp } from './download'
import { listSnapshots, getSnapshot, booksMissingFromCurrent, type SnapshotSummary } from '../state/snapshots'

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
      <LocalSnapshots onMessage={setMessage} />
      {message && <span className={message.error ? 'backup-msg backup-msg-error' : 'backup-msg'}>{message.text}</span>}
    </div>
  )
}

function formatSnapshotTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 自动本地快照的恢复入口：每次改动都可能悄悄落一份滚动快照（见 state/snapshots.ts
// 里 bookStore.persist() 挂的那段逻辑），完全不需要用户操作。这里只负责"万一真出
// 事了，把某个时间点的样子非破坏性地找补回来"——只增不减，从不覆盖/丢弃当前的书
// （跟备份导入是同一条"绝不丢用户的书"的原则，只是数据源换成了自动快照而不是
// 用户手动导出的文件）。低调地放在导出/导入按钮旁边，平时几乎不会被注意到。
function LocalSnapshots({ onMessage }: { onMessage: (m: { text: string; error?: boolean } | null) => void }) {
  const importBooks = useBookStore((s) => s.importBooks)
  const setLibrary = useBookStore((s) => s.setLibrary)
  const [open, setOpen] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])

  const handleToggle = () => {
    if (!open) setSnapshots(listSnapshots())
    setOpen(!open)
  }

  const handleRestore = (ts: number) => {
    const snap = getSnapshot(ts)
    if (!snap) {
      onMessage({ text: '这份快照已经不在了（可能被更新的快照滚动替换掉了）', error: true })
      return
    }
    const cur = useBookStore.getState().library
    const missingBooks = booksMissingFromCurrent(snap, cur)
    if (missingBooks.length > 0) importBooks(missingBooks)

    let boxSuffix = ''
    if (Array.isArray(snap.universalBoxes) && snap.universalBoxes.length > 0) {
      const latest = useBookStore.getState().library
      const universalBoxes = mergeUniversalBoxes(latest.universalBoxes, snap.universalBoxes)
      setLibrary({ ...latest, universalBoxes })
      boxSuffix = '，通用盒子也已非破坏性合并'
    }

    onMessage({ text: `已从快照恢复：找回了 ${missingBooks.length} 本书（当前的书一本都没动）${boxSuffix}` })
    setOpen(false)
  }

  return (
    <div className="local-snapshots">
      <button className="backup-btn" onClick={handleToggle}>
        ⟲ 本地快照
      </button>
      {open && (
        <div className="local-snapshots-menu">
          {snapshots.length === 0 && <p className="local-snapshots-empty">还没有自动快照</p>}
          {snapshots.map((s) => (
            <div key={s.ts} className="local-snapshots-row">
              <span className="local-snapshots-time">{formatSnapshotTime(s.ts)}</span>
              <span className="local-snapshots-desc" title={s.bookTitles.join('、')}>
                {s.bookCount} 本书：{s.bookTitles.join('、') || '（空）'}
              </span>
              <button className="local-snapshots-restore" onClick={() => handleRestore(s.ts)}>
                恢复
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
