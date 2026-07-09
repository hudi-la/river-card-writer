import { useState } from 'react'
import { useAuthStore } from '../state/authStore'

export function SignIn() {
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail)
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

  return (
    <div className="signin-gate">
      <div className="signin-card">
        <p className="signin-title">登录后书会同步到云端</p>
        {sent ? (
          <p className="signin-msg">已发送登录链接，去邮箱点开就登录好了。</p>
        ) : (
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
        )}
        <button className="signin-local" type="button" onClick={continueLocalOnly}>
          先本地用（不登录）
        </button>
      </div>
    </div>
  )
}
