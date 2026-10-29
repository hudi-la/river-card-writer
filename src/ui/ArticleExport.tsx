import { useState } from 'react'
import { Download } from 'lucide-react'
import type { Book } from '../state/bookStore'
import { renderArticle, type Language } from '../../supabase/functions/_shared/article'
import { sanitizeFilename } from '../state/backup'
import { downloadTextFile } from './download'
import { Modal } from './Modal'

export function ArticleExport({ book, menu = false }: { book: Book; menu?: boolean }) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState<Language>('both')
  const [message, setMessage] = useState('')
  const result = renderArticle(book, language)
  return <>
    <button className={menu ? 'book-menu-item' : 'icon-toggle'} title="导出全文" aria-label="导出全文" onClick={(e) => { e.stopPropagation(); setOpen(true); setMessage('') }}>
      <Download size={16} aria-hidden="true" />{menu && '导出全文'}
    </button>
    <Modal open={open} title="导出全文" onClose={() => setOpen(false)}>
      <div className="article-export">
        <label>语言 <select aria-label="导出语言" value={language} onChange={e => { setLanguage(e.target.value as Language); setMessage('') }}>
          <option value="both">中英逐段对照</option><option value="zh">中文</option><option value="en">英文</option>
        </select></label>
        <p>按正文顺序导出，包含折叠章节，不包含素材盒和备料。缺少英文的段落保留中文。</p>
        {result.warnings.map(w => <p role="status" key={w}>{w}</p>)}
        <textarea aria-label="全文预览" readOnly value={result.text} />
        <div className="article-export-actions">
          <button onClick={async () => { try { await navigator.clipboard.writeText(result.text); setMessage('已复制全文') } catch { setMessage('复制失败，请在预览框中全选复制，或下载文件。') } }}>复制全文</button>
          {(['md', 'txt'] as const).map(format => <button key={format} onClick={() => {
            downloadTextFile(`${sanitizeFilename(book.title)}-${language}.${format}`, renderArticle(book, language, format).text, format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8')
            setMessage('已下载全文')
          }}>下载 {format === 'md' ? 'Markdown' : 'TXT'}</button>)}
        </div>
        <p role="status">{message}</p>
      </div>
    </Modal>
  </>
}
