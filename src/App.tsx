import { useEffect } from 'react'
import { useBookStore, UNIVERSAL_BOX_ID } from './state/bookStore'
import { useAuthStore } from './state/authStore'
import { supabase, cloudEnabled } from './lib/supabase'
import { startSync } from './state/sync'
import { Bookshelf } from './ui/Bookshelf'
import { Workspace } from './ui/Workspace'
import { SignIn } from './ui/SignIn'
import { BoxView } from './ui/BoxView'
import { UniversalBoxControls } from './ui/UniversalBoxControls'

// 从书柜直接打开的通用盒子：全屏、没有编辑器上下文——插入按钮在这里没有可插入的
// 文档，交给 BoxView 的 readOnly 禁用它（而不是让它悄悄空操作）。带自己的备份
// 导出/导入（跟整库备份分开，见 UniversalBoxControls）。
function UniversalBoxScreen() {
  const goToShelf = useBookStore((s) => s.goToShelf)
  return (
    <div className="app universal-shell">
      <main className="page">
        <button className="back-to-shelf" onClick={goToShelf}>
          ← 书柜
        </button>
        <div className="universal-box-screen-body">
          <UniversalBoxControls />
          <BoxView boxId={UNIVERSAL_BOX_ID} readOnly />
        </div>
      </main>
    </div>
  )
}

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

  if (shell === 'shelf') return <Bookshelf />
  if (shell === 'universal') return <UniversalBoxScreen />
  return <Workspace />
}
