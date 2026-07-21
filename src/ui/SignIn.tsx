import { useState } from 'react'
import { useAuthStore } from '../state/authStore'

export function SignIn() {
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail)
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const continueLocalOnly = useAuthStore((s) => s.continueLocalOnly)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError(null)
    const res = await signInWithEmail(trimmed)
    setSending(false)
    if (res.sent) {
      setSent(true)
    } else {
      setError(res.error ?? '发送失败，请重试')
    }
  }

  async function handleGoogle() {
    setError(null)
    const res = await signInWithGoogle()
    if (res.error) setError(res.error)
  }

  return (
    <div className="signin-gate">
      <div className="signin-card">
        <p className="signin-title">登录后书会同步到云端</p>
        {sent ? (
          <p className="signin-msg">已发送登录链接，去邮箱点开就登录好了。</p>
        ) : (
          <>
            <button
              className="signin-submit signin-google"
              type="button"
              onClick={handleGoogle}
              style={{ background: '#fff', color: '#1d1d1f', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
              用 Google 登录
            </button>
            <div className="signin-or" style={{ color: '#9a9aa2', fontSize: 12, margin: '10px 0' }}>或用邮箱</div>
            <form onSubmit={handleSubmit}>
            <input
              className="signin-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <button className="signin-submit" type="submit" disabled={sending}>
              {sending ? '发送中…' : '发送登录链接'}
            </button>
            {error && <p className="signin-error">{error}</p>}
            </form>
          </>
        )}
        <button className="signin-local" type="button" onClick={continueLocalOnly}>
          先本地用（不登录）
        </button>
      </div>
    </div>
  )
}
