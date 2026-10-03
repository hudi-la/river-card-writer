import { create } from 'zustand'

// 让编辑器里的划词工具条能触发备料。
//
// 跟 editorBridge 同一个路子：备料的全部状态（正在跑哪些卡、查证缓存、错误）
// 都在 Workspace 里，而工具条在编辑器树的另一侧。与其把那一堆状态搬进全局 store，
// 不如只把"触发"这一个函数登记出来。
type PrepBridgeState = {
  prepPhrase: ((phrase: string) => void) | null
  setPrepPhrase: (fn: ((phrase: string) => void) | null) => void
}

export const usePrepBridge = create<PrepBridgeState>((set) => ({
  prepPhrase: null,
  setPrepPhrase: (fn) => set({ prepPhrase: fn }),
}))
