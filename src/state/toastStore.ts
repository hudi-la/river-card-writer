import { create } from 'zustand'

// 全局轻量 toast：Cmd+S 保存反馈是第一个用它的场景，但故意做成跟"保存"无关的
// 通用通知层——以后别的地方需要一次性、非阻塞的提示都可以复用，不用每个功能
// 各自发明一套气泡 UI。同一时刻只显示一条：新 toast 直接顶替旧的，而不是排队
// 堆叠，避免连续操作（比如手快按了两次 Cmd+S）把屏幕糊满。
export type ToastKind = 'info' | 'success' | 'error'

export type ToastAction = { label: string; onClick: () => void }

export type ToastEntry = {
  id: number
  text: string
  kind: ToastKind
  action?: ToastAction
}

export type ToastState = {
  toast: ToastEntry | null
  show: (opts: { text: string; kind?: ToastKind; action?: ToastAction; durationMs?: number }) => void
  dismiss: () => void
  __resetForTest: () => void
}

let nextId = 0
let dismissTimer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = create<ToastState>((set) => ({
  toast: null,

  show: ({ text, kind = 'info', action, durationMs = 3000 }) => {
    if (dismissTimer) clearTimeout(dismissTimer)
    const id = ++nextId
    set({ toast: { id, text, kind, action } })
    // 按 id 关闭而不是无条件清空：避免这条定时器在慢网络下迟到触发时，把中间
    // 又 show() 出来的新 toast 误关掉。
    dismissTimer = setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : s))
    }, durationMs)
  },

  dismiss: () => {
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = null
    set({ toast: null })
  },

  __resetForTest: () => {
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = null
    set({ toast: null })
  },
}))
