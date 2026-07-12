import type { Library } from './bookStore'
import { pushSnapshot } from './snapshots'
import { flushToCloud, type SyncSupabaseClient } from './sync'

// Cmd/Ctrl+S 手动保存的决策逻辑：跟 UI（toast 文案/按键监听）分开，纯函数式地
// 把"该做什么、结果是什么"暴露出来，方便单测覆盖每条分支，不需要真的挂
// keydown 监听器。
export type SaveOutcome =
  | { kind: 'cloud-success' }
  | { kind: 'cloud-error'; error: string }
  // 本地专属：要么云同步压根没配置（cloud-disabled），要么配置了但当前没登录
  // （not-signed-in）——两种情况下都只做了本地快照，UI 层据此决定要不要展示
  // "去登录"的操作入口（cloud-disabled 时压根没有登录入口可去）。
  | { kind: 'local-only'; reason: 'cloud-disabled' | 'not-signed-in' }

export type PerformSaveOptions = {
  library: Library
  cloudEnabled: boolean
  signedIn: boolean
  ownerId: string | null | undefined
  client: SyncSupabaseClient | null
}

// CRITICAL：这个函数绝不能抛出。它是 Cmd+S 全局快捷键处理器的唯一决策点，任何
// 未捕获的异常都会让用户以为按键没反应、又不敢确定东西到底存没存——所以哪怕
// pushSnapshot/flushToCloud 已经各自兜底过一次，这里仍然整体再包一层 try/catch
// 作为最后一道防线。
export async function performSave(opts: PerformSaveOptions): Promise<SaveOutcome> {
  try {
    pushSnapshot(opts.library)
  } catch {
    // pushSnapshot 按自己的约定从不抛出，这里只是双保险。
  }

  try {
    if (!opts.cloudEnabled) return { kind: 'local-only', reason: 'cloud-disabled' }
    if (!opts.signedIn || !opts.ownerId || !opts.client) return { kind: 'local-only', reason: 'not-signed-in' }

    const result = await flushToCloud(opts.client, opts.ownerId, opts.library)
    if (result.ok) return { kind: 'cloud-success' }
    return { kind: 'cloud-error', error: result.error }
  } catch (e) {
    return { kind: 'cloud-error', error: e instanceof Error ? e.message : String(e) }
  }
}
