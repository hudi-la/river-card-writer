import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createAuthStore } from './authStore'

function makeMockClient(overrides: Partial<Record<'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'signOut', any>> = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    },
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('authStore', () => {
  it('cloudEnabled=false（无 client）→ status 直接 signed-out，app 仍可用', () => {
    const store = createAuthStore(null, false)
    store.getState().init()
    expect(store.getState().status).toBe('signed-out')
  })

  it('init()：getSession 返回已有 session → status signed-in', async () => {
    const session = { access_token: 'tok' } as any
    const client = makeMockClient({ getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }) })
    const store = createAuthStore(client as any, true)
    store.getState().init()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getState().status).toBe('signed-in')
    expect(store.getState().session).toBe(session)
  })

  it('init()：无 session → status signed-out', async () => {
    const client = makeMockClient()
    const store = createAuthStore(client as any, true)
    store.getState().init()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.getState().status).toBe('signed-out')
  })

  it('signInWithEmail 成功：调用 signInWithOtp，返回 { sent: true }', async () => {
    const client = makeMockClient()
    const store = createAuthStore(client as any, true)
    const res = await store.getState().signInWithEmail('a@b.com')
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      options: { emailRedirectTo: window.location.origin },
    })
    expect(res).toEqual({ sent: true })
  })

  it('signInWithEmail 失败：返回 { sent: false, error }', async () => {
    const client = makeMockClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: null, error: { message: '发送失败' } }) })
    const store = createAuthStore(client as any, true)
    const res = await store.getState().signInWithEmail('a@b.com')
    expect(res).toEqual({ sent: false, error: '发送失败' })
  })

  it('cloudEnabled=false 时 signInWithEmail 直接返回 sent:false + error，不崩', async () => {
    const store = createAuthStore(null, false)
    const res = await store.getState().signInWithEmail('a@b.com')
    expect(res.sent).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('signOut：调用 auth.signOut 并把 status 置为 signed-out', async () => {
    const client = makeMockClient()
    const store = createAuthStore(client as any, true)
    store.setState({ session: { access_token: 'x' } as any, status: 'signed-in' })
    await store.getState().signOut()
    expect(client.auth.signOut).toHaveBeenCalled()
    expect(store.getState().status).toBe('signed-out')
    expect(store.getState().session).toBe(null)
  })

  it('continueLocalOnly：置 localOnly=true 并持久化', () => {
    const store = createAuthStore(null, false)
    expect(store.getState().localOnly).toBe(false)
    store.getState().continueLocalOnly()
    expect(store.getState().localOnly).toBe(true)
    expect(localStorage.getItem('card-writer:local-only')).toBe('1')
  })

  it('requestSignIn：把 localOnly 翻回 false，但不碰持久化标记（Cmd+S 未登录 toast 的"点此登录"用）', () => {
    const store = createAuthStore(null, false)
    store.getState().continueLocalOnly()
    expect(store.getState().localOnly).toBe(true)
    expect(localStorage.getItem('card-writer:local-only')).toBe('1')

    store.getState().requestSignIn()

    expect(store.getState().localOnly).toBe(false)
    // 持久化的标记原样保留——刷新页面后仍然遵循用户之前"先本地用"的选择。
    expect(localStorage.getItem('card-writer:local-only')).toBe('1')
  })
})
