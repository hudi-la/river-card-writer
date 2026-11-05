import { useEffect, useMemo, useRef, useState } from 'react'
import { History } from 'lucide-react'
import { useBookStore, type Book } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { useToastStore } from '../state/toastStore'
import { renderArticle } from '../../supabase/functions/_shared/article'
import { AUTO_VERSION_MS, compareCards, compareText, versionContent, type ArticleVersion, type VersionDetail } from '../versions/model'
import { copyVersion, loadVersion, restoreVersion, saveVersion, versionApi } from '../versions/client'
import { exportBook, sanitizeFilename } from '../state/backup'
import { downloadTextFile } from './download'
import { Modal } from './Modal'

export function ArticleVersions({ book, onRestored }: { book: Book; onRestored: () => void }) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<ArticleVersion[]>([])
  const [selected, setSelected] = useState<VersionDetail | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [autoError, setAutoError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const status = useAuthStore(s => s.status)
  const owner = useAuthStore(s => s.session?.user.id)
  const requestSignIn = useAuthStore(s => s.requestSignIn)
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const identity = useRef({ owner, bookId: book.id })
  identity.current = { owner, bookId: book.id }
  const refresh = async () => {
    const result = await versionApi(`?bookId=${encodeURIComponent(book.id)}`, {}, owner)
    if (mounted.current && identity.current.owner === owner) setVersions(result.versions)
  }

  useEffect(() => {
    let stopped = false, saving = false, lastContent: string | null = null
    setVersions([]); setSelected(null); setConfirm(false); setMessage(''); setAutoError('')
    if (status !== 'signed-in') return
    const capture = async () => {
      if (saving) return
      const current = useBookStore.getState().library.books.find(b => b.id === book.id)
      if (!current) return
      const content = versionContent(current)
      if (content === lastContent) return
      saving = true
      try {
        const saved = await saveVersion(current, 'auto', '自动保存', owner)
        if (!stopped) {
          lastContent = content; setAutoError('')
          setVersions(list => [saved, ...list.filter(v => v.id !== saved.id)])
        }
      } catch (e) {
        if (!stopped) setAutoError(e instanceof Error ? e.message : '自动历史保存失败')
      } finally { saving = false }
    }
    void capture()
    const timer = setInterval(() => void capture(), AUTO_VERSION_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [book.id, owner, status])

  const run = async (action: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setMessage('')
    try { await action() } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { locked.current = false; setBusy(false) }
  }
  const textChanges = useMemo(() => selected ? compareText(renderArticle(selected.book).text, renderArticle(book).text) : [], [selected, book])
  const delta = selected ? compareCards(selected.book, book) : null
  return <>
    <button className="icon-toggle" aria-label="版本历史" title={autoError ? `版本历史：${autoError}` : '版本历史'} data-error={autoError ? 'true' : undefined} onClick={() => {
      setOpen(true); setSelected(null); setConfirm(false)
      if (status === 'signed-in') void run(refresh)
    }}><History size={16} aria-hidden="true" /></button>
    <Modal open={open} title="版本历史" onClose={() => { if (!locked.current) setOpen(false) }}>
      <div className="article-versions">
        <p>整篇保存正文、卡片顺序、格式、译文和本书素材盒。历史仅本人可见。</p>
        <p className="versions-hint">打开文章时留存一份，之后有修改时每 5 分钟自动留存，保留最近 30 份。命名版本与恢复前备份长期保留。通用盒子不随文章恢复。</p>
        {status !== 'signed-in' ? <button onClick={() => { setOpen(false); requestSignIn() }}>登录后使用版本历史</button> : <>
          {autoError && <p role="alert">自动历史未保存：{autoError} 可以点击下方保存版本重试。</p>}
          <form className="version-save" onSubmit={e => {
            e.preventDefault()
            if (!name.trim()) return
            void run(async () => {
              const latest = useBookStore.getState().library.books.find(b => b.id === book.id)
              if (!latest) throw new Error('当前文章已不存在')
              await saveVersion(latest, 'named', name.trim()); setName(''); setAutoError(''); await refresh(); setMessage('版本已保存到云端')
            })
          }}>
            <label>版本名称<input maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="例如：一稿、发给编辑版" /></label>
            <button disabled={busy || !name.trim()} type="submit">保存版本</button>
            <button type="button" disabled={busy} onClick={() => void run(refresh)}>刷新历史</button>
          </form>
          <div className="version-browser" aria-busy={busy}>
            <nav aria-label="文章历史版本" className="version-list">
              {!versions.length && <p>{busy ? '正在读取历史…' : '暂无版本，可保存第一份命名版本。'}</p>}
              {versions.map(v => <button key={v.id} disabled={busy} aria-current={selected?.id === v.id ? 'true' : undefined} onClick={() => void run(async () => {
                setConfirm(false); setSelected(await loadVersion(v.id, book.id))
              })}><strong>{v.name}</strong><small>{v.kind === 'auto' ? '自动历史' : v.kind === 'safety' ? '恢复前备份' : '命名版本'} · {new Date(v.created_at).toLocaleString()}</small></button>)}
            </nav>
            <section className="version-preview" aria-label="版本预览">
              {selected ? <>
                <h3>{selected.name}</h3>
                <p>从此版本到当前：新增 {delta!.added} 张、删除 {delta!.removed} 张、修改 {delta!.changed} 张、位置变化 {delta!.moved} 张。</p>
                <p className="versions-hint">修改包括格式和卡片译文；无编号的旧卡片按位置比较。标题与素材盒等内容请结合完整备份查看。</p>
                <details className="version-diff">
                  <summary>查看文字增删（以段落为单位）</summary>
                  <p className="versions-hint">删除的段落带删除线，新增的段落带下划线；移动的段落可能显示为删除后新增。</p>
                  {textChanges.map((change, index) => <p key={index}>{change.kind === 'removed' ? <del>{change.text}</del> : change.kind === 'added' ? <ins>{change.text}</ins> : change.text}</p>)}
                </details>
                <div className="version-texts">
                  <label>历史全文<textarea aria-label="历史全文" readOnly value={renderArticle(selected.book).text} /></label>
                  <label>当前全文<textarea aria-label="当前全文" readOnly value={renderArticle(book).text} /></label>
                </div>
                <div className="article-export-actions">
                  <button disabled={busy} onClick={() => downloadTextFile(`${sanitizeFilename(selected.book.title)}-${sanitizeFilename(selected.name)}.json`, exportBook(selected.book), 'application/json;charset=utf-8')}>下载此版备份</button>
                  <button disabled={busy} onClick={() => { copyVersion(selected); setMessage('已将旧版另存为副本，可在书柜查看。') }}>另存为副本</button>
                  <button disabled={busy} onClick={() => setConfirm(true)}>恢复此版本</button>
                </div>
                {confirm && <div className="version-confirm">
                  <p>将用「{selected.name}」替换当前文章。会先保存当前内容为恢复前备份，保存失败则取消恢复。</p>
                  <button disabled={busy} onClick={() => void run(async () => {
                    const ownerAtStart = owner
                    await restoreVersion(selected, () => mounted.current && useAuthStore.getState().session?.user.id === ownerAtStart && identity.current.owner === ownerAtStart && identity.current.bookId === selected.book.id && useBookStore.getState().library.activeBookId === selected.book.id)
                    onRestored(); setConfirm(false); setSelected(null)
                    useToastStore.getState().show({ text: '已恢复旧版，恢复前的内容已留存', kind: 'success' })
                    await refresh(); setMessage('已恢复，可从恢复前备份找回刚才的内容。')
                  })}>保存当前内容并恢复</button>
                  <button disabled={busy} onClick={() => setConfirm(false)}>取消</button>
                </div>}
              </> : <p>选择一个版本预览。预览不会改变当前文章。</p>}
            </section>
          </div>
        </>}
        <p role="status">{busy ? '处理中…' : message}</p>
      </div>
    </Modal>
  </>
}
