import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// 通用悬浮大窗（Phase 14 Task 2）：遮罩 + 居中大面板，纯展示壳，不掺任何具体
// 业务内容——大纲详细视图（OutlineDetail）、后续 Task 4 的通用盒子视图都靠
// children 塞进来，Modal 自己只管"开/关/标题/关闭方式"这几件事。
//
// 关闭方式两种：点遮罩、按 Esc；都只是调用方传入的 onClose，Modal 不持有
// 自己的开关状态（open 由外部 state 控制，符合受控组件习惯，方便调用方在
// 关闭前后做别的事，比如聚焦回触发按钮）。
export function Modal({
  open,
  title,
  onClose,
  children,
  className = '',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  // 额外挂在 .modal-backdrop 上的 class——目前只用来给"卡片编辑大窗"叠一个更高的
  // z-index（见 styles.css .modal-backdrop--card-edit），保证它在通用盒子悬浮大窗
  // 之上，不依赖两个 Modal 实例挂载到 document.body 的先后顺序。
  className?: string
}) {
  // Esc 关闭：只在打开时挂监听，避免关闭状态下也占着一个全局 keydown。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className={className ? `modal-backdrop ${className}` : 'modal-backdrop'}
      onClick={onClose}
    >
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // 面板本身要挡住冒泡，不然点面板内部（比如点一下空白处）也会被当成
        // 点遮罩，把窗关掉。
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
