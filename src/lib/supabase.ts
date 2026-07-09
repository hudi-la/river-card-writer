import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// 无 env（本地开发未配置 / CI）时纯本地可用，不崩：cloudEnabled=false，supabase=null。
export const cloudEnabled = !!(url && key)

export const supabase = cloudEnabled ? createClient(url as string, key as string) : null
