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
