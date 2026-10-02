import { supabase } from '../lib/supabase'
import { buildPrepRequest } from './prompt'
import { parsePrepResponse } from './parse'
import type { AiPolicy, PrepResult } from './types'
import type { FetchFreqs } from './verify'

// invoke 抽成可注入的依赖：测试不能真的打到线上 Edge Function。跟 triggerSave /
// startSync 一样的"默认走真实模块、测试可注入"约定。
export type InvokeFn = (
  name: string,
  opts: { body: unknown }
) => Promise<{ data: any; error: { message: string } | null }>

function defaultInvoke(name: string, opts: { body: unknown }) {
  if (!supabase) return Promise.resolve({ data: null, error: { message: '没有配置云同步，备料需要登录后才能用' } })
  return (supabase as unknown as { functions: { invoke: InvokeFn } }).functions.invoke(name, opts)
}

// 永不抛出：任何失败都变成 { ok: false, error }，由 UI 决定怎么告诉作者。
export async function requestPrep(
  zhTexts: string[],
  policy: AiPolicy = 'strict',
  deps: { invoke?: InvokeFn } = {}
): Promise<{ ok: true; value: PrepResult; warnings?: string[] } | { ok: false; error: string }> {
  const invoke = deps.invoke ?? defaultInvoke
  try {
    const { system, user } = buildPrepRequest(zhTexts, policy)
    const { data, error } = await invoke('prep', { body: { kind: 'model', system, user } })
    if (error) return { ok: false, error: error.message }
    if (data?.error) return { ok: false, error: String(data.error) }
    if (!data?.text) return { ok: false, error: '服务端没有返回内容' }
    // 用同一个 policy 校验：strict 档下模型若夹带成句，这里拒收而不是悄悄收下。
    return parsePrepResponse(data.text, policy)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// 语料查证也走 Edge Function：Ngrams 端点不返回 CORS 头，浏览器直连会被拦。
// 这里刻意会抛出——createVerifier 接到异常时整批降级成"未查证"且不写缓存，
// 那正是我们要的行为（一次网络抖动不该把一整批好词永久钉死）。
export function makeFetchFreqs(deps: { invoke?: InvokeFn } = {}): FetchFreqs {
  const invoke = deps.invoke ?? defaultInvoke
  return async (forms: string[]) => {
    const { data, error } = await invoke('prep', { body: { kind: 'ngram', forms } })
    if (error) throw new Error(error.message)
    if (!data?.freqs) throw new Error('服务端没有返回 freqs')
    return data.freqs as Record<string, number | null>
  }
}
