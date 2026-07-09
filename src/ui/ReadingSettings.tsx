import { useState } from 'react'
import { usePrefsStore } from '../state/prefsStore'

export function ReadingSettings() {
  const prefs = usePrefsStore((s) => s.prefs)
  const setFont = usePrefsStore((s) => s.setFont)
  const setSize = usePrefsStore((s) => s.setSize)
  const setMeasure = usePrefsStore((s) => s.setMeasure)
  const [open, setOpen] = useState(false)

  return (
    <div className="reading-settings">
      <button
        className="settings-gear"
        title="阅读设置"
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div className="settings-panel">
          <div className="settings-row">
            <button
              className={prefs.font === 'serif' ? 'on' : undefined}
              onClick={() => setFont('serif')}
            >
              衬线
            </button>
            <button
              className={prefs.font === 'sans' ? 'on' : undefined}
              onClick={() => setFont('sans')}
            >
              无衬线
            </button>
          </div>
          <label className="settings-row">
            字号
            <input
              type="range"
              aria-label="字号"
              min={13}
              max={20}
              value={prefs.size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </label>
          <label className="settings-row">
            行宽
            <input
              type="range"
              aria-label="行宽"
              min={560}
              max={820}
              value={prefs.measure}
              onChange={(e) => setMeasure(Number(e.target.value))}
            />
          </label>
        </div>
      )}
    </div>
  )
}
