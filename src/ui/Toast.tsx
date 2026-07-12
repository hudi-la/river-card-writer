import { createPortal } from 'react-dom'
import { useToastStore } from '../state/toastStore'

// 非阻塞的一次性提示条：跟 Modal 不同，不遮罩、不抢焦点、自动消失——Cmd+S 保存
// 反馈需要的是"瞟一眼就知道结果"，不是打断当前正在写的东西。挂在 body 下（跟
// Modal 一样用 portal），不受任何具体页面的布局/裁剪影响。
export function Toast() {
  const toast = useToastStore((s) => s.toast)
  const dismiss = useToastStore((s) => s.dismiss)

  if (!toast) return null

  return createPortal(
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      <span className="toast-text">{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick()
            dismiss()
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="关闭提示" onClick={dismiss}>
        ✕
      </button>
    </div>,
    document.body
  )
}
