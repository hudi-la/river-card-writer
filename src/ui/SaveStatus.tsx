import { useSaveStatus } from '../state/saveStatus'
import { useBookStore } from '../state/bookStore'
import { exportLibrary } from '../state/backup'
import { downloadTextFile, todayStamp } from './download'
export function SaveStatus() {
  const { cloud, cloudError, localError, retry } = useSaveStatus()
  if (cloud === 'idle' && !localError) return null
  const error = !!localError || cloud === 'error'
  return <aside className={`save-status${error ? ' save-status-error' : ''}`} role={error ? 'alert' : 'status'}>
    <span>{localError || (cloud === 'error' ? '尚未同步到云端，将自动重试。请保持本页打开。' : cloud === 'saving' ? '正在同步…' : '已同步到云端')}</span>
    {cloud === 'error' && <span className="save-status-detail">{cloudError}</span>}
    {error && retry && <button onClick={() => void retry()}>重试保存</button>}
    {error && <button onClick={() => downloadTextFile(`River-备份-${todayStamp()}.json`, exportLibrary(useBookStore.getState().library))}>导出备份</button>}
  </aside>
}
