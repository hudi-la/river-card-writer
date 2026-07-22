import { useState, useRef, useEffect } from 'react'
import { useAuthStore } from '../state/authStore'
import { cloudEnabled } from '../lib/supabase'

// 邮箱哈希出一个柔和色，给没有 Google 头像时的首字母底色用（呼应封面那套低饱和调）。
function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

// 用户中心：右上角圆头像，点开下拉（名字 / 邮箱 / 登出）。未登录显示"登录"。
// 云同步没配置（本地开发/CI）时整块不渲染。
export function UserCenter() {
  const status = useAuthStore((s) => s.status)
  const session = useAuthStore((s) => s.session)
  const signOut = useAuthStore((s) => s.signOut)
  const requestSignIn = useAuthStore((s) => s.requestSignIn)
  const [open, setOpen] = useState(false)
  const [imgError, setImgError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部 / 按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!cloudEnabled) return null

  const email = session?.user?.email ?? ''
  const meta = (session?.user?.user_metadata ?? {}) as Record<string, any>
  const signedIn = status === 'signed-in' && !!email

  // 未登录：一个安静的"登录"入口
  if (!signedIn) {
    return (
      <div className="user-center" style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px' }}>
        <button
          type="button"
          onClick={() => requestSignIn()}
          style={{ border: 'none', background: 'transparent', color: '#0a84ff', cursor: 'pointer', fontSize: 13, padding: '4px 6px' }}
        >
          登录后同步到云端
        </button>
      </div>
    )
  }

  const avatarUrl: string | undefined = meta.avatar_url || meta.picture
  const name: string = meta.full_name || meta.name || email.split('@')[0]
  const initial = (name || email).trim().charAt(0).toUpperCase()
  const hue = hashHue(email)
  const showImg = !!avatarUrl && !imgError

  return (
    <div className="user-center" style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px' }}>
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="账户"
          onClick={() => setOpen((v) => !v)}
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: showImg ? 'transparent' : `hsl(${hue} 45% 58%)`,
            color: '#fff',
            fontSize: 15,
            fontWeight: 600,
            boxShadow: open ? '0 0 0 2px rgba(10,132,255,0.5)' : '0 1px 2px rgba(0,0,0,0.12)',
          }}
        >
          {showImg ? (
            <img
              src={avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            initial || '👤'
          )}
        </button>

        {open && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: 42,
              right: 0,
              minWidth: 220,
              background: '#fff',
              borderRadius: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
              border: '1px solid rgba(0,0,0,0.06)',
              padding: 6,
              zIndex: 50,
            }}
          >
            <div style={{ padding: '8px 10px 10px' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </div>
              <div style={{ fontSize: 12, color: '#8a8a8e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={email}>
                {email}
              </div>
            </div>
            <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '2px 0' }} />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                signOut()
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f4f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: '#1d1d1f',
                fontSize: 14,
                padding: '9px 10px',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              登出
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
