import { useAuthStore } from '../state/authStore'
import { cloudEnabled } from '../lib/supabase'

// 用户中心（最小版）：登录后显示邮箱 + 登出；本地/未登录显示"登录"。
// 云同步没配置（本地开发/CI）时整块不渲染，不打扰。
export function UserCenter() {
  const status = useAuthStore((s) => s.status)
  const session = useAuthStore((s) => s.session)
  const signOut = useAuthStore((s) => s.signOut)
  const requestSignIn = useAuthStore((s) => s.requestSignIn)

  if (!cloudEnabled) return null

  const email = session?.user?.email
  const signedIn = status === 'signed-in' && !!email

  return (
    <div
      className="user-center"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '4px 2px', fontSize: 13, color: '#6b6b73' }}
    >
      {signedIn ? (
        <>
          <span
            title={email}
            style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {email}
          </span>
          <button
            type="button"
            onClick={() => signOut()}
            style={{ border: 'none', background: 'transparent', color: '#0a84ff', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
          >
            登出
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => requestSignIn()}
          style={{ border: 'none', background: 'transparent', color: '#0a84ff', cursor: 'pointer', fontSize: 13, padding: '2px 4px' }}
        >
          登录后同步到云端
        </button>
      )}
    </div>
  )
}
