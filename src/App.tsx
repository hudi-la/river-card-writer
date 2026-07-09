import { useEffect } from 'react'
import { useBookStore } from './state/bookStore'
import { useAuthStore } from './state/authStore'
import { cloudEnabled } from './lib/supabase'
import { Bookshelf } from './ui/Bookshelf'
import { Workspace } from './ui/Workspace'
import { SignIn } from './ui/SignIn'

export function App() {
  const shell = useBookStore((s) => s.shell)
  const status = useAuthStore((s) => s.status)
  const localOnly = useAuthStore((s) => s.localOnly)
  const init = useAuthStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  if (cloudEnabled && status === 'loading') {
    return <div className="auth-loading">加载中…</div>
  }
  if (cloudEnabled && status === 'signed-out' && !localOnly) {
    return <SignIn />
  }

  return shell === 'shelf' ? <Bookshelf /> : <Workspace />
}
