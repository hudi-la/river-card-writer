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
    signInWithOAuth: (credentials: {
      provider: 'google'
      options?: { redirectTo?: string }
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
  signInWithGoogle: () => Promise<{ error?: string }>
  signOut: () => Promise<void>
  continueLocalOnly: () => void
  // Cmd+S 未登录时 toast 上"点此登录"用：只在内存里把 localOnly 翻回 false，
  // 让 App 重新展示登录门（不动持久化的 localStorage 标记）——这样刷新页面后
  // 仍然遵循用户之前"先本地用"的选择，这次只是应用户主动请求临时露出入口。
  requestSignIn: () => void
  __resetForTest: () => void
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
      if (error) return { sent: false, error: error.message }
      return { sent: true }
    },

    // Google 登录：跳转 OAuth。回来后 onAuthStateChange 会把 session 接上（与邮箱登录同一套 auth，
    // 同一个 Supabase 项目 + 同一个 auth UUID，跨 app 账号统一）。
    signInWithGoogle: async () => {
      if (!enabled || !client) return { error: '云同步未配置，暂不能登录' }
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) return { error: error.message }
      return {}
    },

    signOut: async () => {
      if (client) await client.auth.signOut()
      set({ session: null, status: 'signed-out' })
    },

    continueLocalOnly: () => {
      persistLocalOnly()
      set({ localOnly: true })
    },

    requestSignIn: () => set({ localOnly: false }),

    __resetForTest: () => set({ session: null, status: 'loading', localOnly: false }),
  }))
}

export const useAuthStore = createAuthStore()
