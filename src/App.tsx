import { useEffect } from 'react'
import { useBookStore } from './state/bookStore'
import { useAuthStore } from './state/authStore'
import { supabase, cloudEnabled } from './lib/supabase'
import { startSync } from './state/sync'
import { Bookshelf } from './ui/Bookshelf'
import { Workspace } from './ui/Workspace'
import { SignIn } from './ui/SignIn'

export function App() {
  const shell = useBookStore((s) => s.shell)
  const status = useAuthStore((s) => s.status)
  const session = useAuthStore((s) => s.session)
  const localOnly = useAuthStore((s) => s.localOnly)
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  // 登录后启动云同步（首登迁移 + 后续防抖 upsert）；signOut / 状态变化时停订阅。
  useEffect(() => {
    if (status !== 'signed-in' || !session?.user?.id) return
    const stop = startSync(useBookStore, supabase, session.user.id)
    return stop
  }, [status, session?.user?.id])

  if (cloudEnabled && status === 'loading') {
    return <div className="auth-loading">加载中…</div>
  }
  if (cloudEnabled && status === 'signed-out' && !localOnly) {
    return <SignIn />
  }

  return shell === 'shelf' ? <Bookshelf /> : <Workspace />
}
