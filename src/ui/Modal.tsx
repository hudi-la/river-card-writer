import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const modalStack: HTMLElement[] = []

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
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const panel = panelRef.current
    if (!open || !panel) return
    const previous = document.activeElement as HTMLElement | null
    modalStack.push(panel)
    if (!panel.contains(document.activeElement)) panel.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== panel) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const items = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"], [contenteditable="true"]')).filter(el => !el.closest('[hidden], [inert]') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
      const first = items[0], last = items[items.length - 1]
      if (!first) { e.preventDefault(); panel.focus(); return }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel || !panel.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel || !panel.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      const wasTop = modalStack[modalStack.length - 1] === panel
      const index = modalStack.indexOf(panel)
      if (index !== -1) modalStack.splice(index, 1)
      if (wasTop && previous?.isConnected) previous.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className={className ? `modal-backdrop ${className}` : 'modal-backdrop'}
      onClick={onClose}
    >
      <div
        className="modal-panel"
        ref={panelRef}
        tabIndex={-1}
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
