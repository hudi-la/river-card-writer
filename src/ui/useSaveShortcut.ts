import { useEffect } from 'react'
import { useBookStore } from '../state/bookStore'
import { useAuthStore } from '../state/authStore'
import { useToastStore } from '../state/toastStore'
import { supabase, cloudEnabled } from '../lib/supabase'
import { performSave } from '../state/save'
import type { SyncSupabaseClient } from '../state/sync'

// Cmd/Ctrl+S 是不是这次要接管的组合键：跟浏览器"保存网页"抢的同一个键位，只在
// 命中时才 preventDefault，别的按键（比如普通的 s）完全不受影响。
export function isSaveShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's'
}

function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// triggerSave 依赖真实的 lib/supabase 单例作为默认值，方便在 App 里零参数调用；
// 单测需要注入假 client（不能让测试真的打到线上 supabase 项目），所以两个字段都
// 允许覆盖——同一套"默认走真实模块、测试可注入"的约定，跟 createAuthStore /
// startSync 一致。
export type TriggerSaveDeps = {
  cloudEnabled: boolean
  client: SyncSupabaseClient | null
}

const defaultDeps: TriggerSaveDeps = { cloudEnabled, client: supabase }

// 实际执行一次 Cmd+S 保存：读一次全局 store 的最新快照式状态（不用 hook 订阅，
// 避免这个函数本身要在 React 渲染树里才能跑，方便直接单测），据此决定走云端
// 强制上传还是纯本地路径，并把结果转成用户能看懂的 toast。
export async function triggerSave(deps: TriggerSaveDeps = defaultDeps): Promise<void> {
  const library = useBookStore.getState().library
  const auth = useAuthStore.getState()
  const showToast = useToastStore.getState().show

  const signedIn = deps.cloudEnabled && auth.status === 'signed-in' && !!auth.session?.user?.id

  showToast({ text: '正在保存…', kind: 'info', durationMs: 8000 })

  const outcome = await performSave({
    library,
    cloudEnabled: deps.cloudEnabled,
    signedIn,
    ownerId: auth.session?.user?.id,
    client: deps.client,
  })

  if (outcome.kind === 'cloud-success') {
    showToast({ text: `已保存到云端 ✓ ${formatTime(new Date())}`, kind: 'success' })
    return
  }
  if (outcome.kind === 'cloud-error') {
    showToast({ text: `保存失败：${outcome.error}`, kind: 'error', durationMs: 5000 })
    return
  }
  // local-only：诚实反馈——没有登录/没配置云同步时，绝不能让用户误以为已经上云了。
  if (outcome.reason === 'not-signed-in') {
    showToast({
      text: '已存到本地（未登录，不会上云）',
      kind: 'info',
      action: { label: '点此登录', onClick: () => useAuthStore.getState().requestSignIn() },
    })
  } else {
    showToast({ text: '已存到本地（云同步未配置）', kind: 'info' })
  }
}

// 全局挂载一次（App 顶层）：window 上监听 keydown，命中 Cmd/Ctrl+S 就
// preventDefault（拦掉浏览器自己的"保存网页"对话框）并触发 triggerSave。
export function useSaveShortcut(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isSaveShortcut(e)) return
      e.preventDefault()
      void triggerSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
