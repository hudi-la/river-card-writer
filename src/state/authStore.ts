import { create } from 'zustand'
import type { AuthSession as Session } from '@supabase/supabase-js'
import { supabase as defaultClient, cloudEnabled as defaultCloudEnabled } from '../lib/supabase'

const LOCAL_ONLY_KEY = 'card-writer:local-only'

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out'

// 只声明 authStore 实际用到的那部分 supabase auth 接口，方便测试注入 mock，
// 同时真实的 SupabaseClient 结构上完全满足这个形状。
export type AuthClient = {
  auth: {
    getSession: () => Promise<{ data: { session: Session | null } }>
    onAuthStateChange: (
      callback: (event: string, session: Session | null) => void
    ) => { data: { subscription: { unsubscribe: () => void } } }
    signInWithOtp: (credentials: {
      email: string
      options?: { emailRedirectTo?: string }
    }) => Promise<{ data: unknown; error: { message: string } | null }>
    signOut: () => Promise<{ error: { message: string } | null }>
  }
}

export type AuthState = {
  session: Session | null
  status: AuthStatus
  localOnly: boolean
  init: () => void
  signInWithEmail: (email: string) => Promise<{ sent: boolean; error?: string }>
  signOut: () => Promise<void>
  continueLocalOnly: () => void
  __resetForTest: () => void
}

// Supabase auth 返回的是英文技术错误（如 "email rate limit exceeded"），
// 这里映射成对用户友好的中文提示，未知错误原样透传。
export function friendlyAuthError(raw: string): string {
  const msg = raw.toLowerCase()
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return '发送太频繁啦：登录邮件每小时能发的数量有限，请过一会儿（约一小时）再试，或先点下面「先本地用（不登录）」。'
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return '邮箱格式好像不对，检查一下再发。'
  }
  if (msg.includes('signups not allowed') || msg.includes('signup is disabled')) {
    return '这个邮箱还没开通登录，换一个或先点「先本地用（不登录）」。'
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return '网络没连上，检查一下网络再试。'
  }
  return raw
}

function loadLocalOnly(): boolean {
  try {
    return localStorage.getItem(LOCAL_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

function persistLocalOnly() {
  try {
    localStorage.setItem(LOCAL_ONLY_KEY, '1')
  } catch (e) {
    console.warn('persist failed', e)
  }
}

export function createAuthStore(client: AuthClient | null = defaultClient, enabled: boolean = defaultCloudEnabled) {
  return create<AuthState>((set) => ({
    session: null,
    status: 'loading',
    localOnly: loadLocalOnly(),

    init: () => {
      if (!enabled || !client) {
        set({ status: 'signed-out' })
        return
      }
      client.auth.getSession().then(({ data }) => {
        set({ session: data.session, status: data.session ? 'signed-in' : 'signed-out' })
      })
      client.auth.onAuthStateChange((_event, session) => {
        set({ session, status: session ? 'signed-in' : 'signed-out' })
      })
    },

    signInWithEmail: async (email) => {
      if (!enabled || !client) return { sent: false, error: '云同步未配置，暂不能登录' }
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) return { sent: false, error: friendlyAuthError(error.message) }
      return { sent: true }
    },

    signOut: async () => {
      if (client) await client.auth.signOut()
      set({ session: null, status: 'signed-out' })
    },

    continueLocalOnly: () => {
      persistLocalOnly()
      set({ localOnly: true })
    },

    __resetForTest: () => set({ session: null, status: 'loading', localOnly: false }),
  }))
}

export const useAuthStore = createAuthStore()
