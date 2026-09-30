import type { Candidate, Genre, PrepResult, Target } from './types'

// 「我没有缺点」的各种说法。模型倾向于用这些糊过去，一律当成没填。
const EMPTY_LOSES = new Set(['', '无', '没有', 'n/a', 'na', 'none', '—', '-', '不适用'])

// 判断一个字段里是不是塞进了整句英文。启发式：连续 8 个以上的英文单词，或者
// 出现句末标点后又接着大写开头——那就是句子，不是词典条目该有的东西。
// 宁可偶尔误伤（作者会看到拒收原因），也不能让成句从侧门溜进来。
function looksLikeSentence(s: string): boolean {
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
  if (words.length >= 8) return true
  return /[.!?]\s+[A-Z]/.test(s)
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

type Fail = { ok: false; error: string }
type Ok = { ok: true; value: PrepResult }

function fail(error: string): Fail {
  return { ok: false, error }
}

function isFail(x: unknown): x is Fail {
  return !!x && typeof x === 'object' && 'ok' in (x as object) && (x as Fail).ok === false
}

function parseCandidate(raw: any, where: string): Candidate | Fail {
  if (!raw || typeof raw !== 'object') return fail(`${where}：候选不是对象`)
  const loses = typeof raw.loses === 'string' ? raw.loses : ''
  if (EMPTY_LOSES.has(loses.trim().toLowerCase())) {
    return fail(`${where}：候选「${raw.en}」缺 loses（它丢了什么）。没有任何候选可以只有优点。`)
  }
  const verifyForm = typeof raw.verify_form === 'string' ? raw.verify_form.trim() : ''
  if (!verifyForm) return fail(`${where}：候选「${raw.en}」缺 verify_form`)
  if (wordCount(verifyForm) > 5) {
    return fail(`${where}：verify_form「${verifyForm}」超过 5 个词，语料里查不到，会把好词误报成未查证`)
  }
  for (const [field, v] of [
    ['nuance', raw.nuance],
    ['loses', loses],
    ['why_fits', raw.why_fits],
  ] as const) {
    if (typeof v === 'string' && looksLikeSentence(v)) {
      return fail(`${where}：${field} 里出现了整句英文。条目里不该有句子。`)
    }
  }
  return {
    en: String(raw.en ?? ''),
    verifyForm,
    register: String(raw.register ?? ''),
    nuance: String(raw.nuance ?? ''),
    whyFits: String(raw.why_fits ?? ''),
    loses,
  }
}

function parseTarget(raw: any, genre: Genre, i: number): Target | Fail {
  const where = `第 ${i + 1} 条靶心`
  if (!raw || typeof raw !== 'object') return fail(`${where}：不是对象`)
  // 承重句只存在于议论/学术文体。叙事文没有论点句——模型曾经借这个分类表达
  // "这条最重要"，那是 priority 的活。
  if (raw.category === '承重句' && genre !== 'expository') {
    return fail(`${where}：文体是 ${genre}，不该出现「承重句」分类（那是议论文专属；重要程度用 priority）`)
  }
  const rawCands = Array.isArray(raw.candidates) ? raw.candidates : []
  if (rawCands.length === 0) return fail(`${where}：一个候选都没有`)
  const candidates: Candidate[] = []
  for (const rc of rawCands) {
    const c = parseCandidate(rc, where)
    if (isFail(c)) return c
    candidates.push(c)
  }
  const ft = raw.flat_translation ?? {}
  return {
    zh: String(raw.zh ?? ''),
    zhQuote: String(raw.zh_quote ?? ''),
    category: String(raw.category ?? ''),
    priority: Number.isFinite(raw.priority) ? Number(raw.priority) : 3,
    whyZhIsPrecise: String(raw.why_zh_is_precise ?? ''),
    flatTranslation: { text: String(ft.text ?? ''), whyItDies: String(ft.why_it_dies ?? '') },
    candidates,
    noSingleWord: raw.no_single_word === true,
    family: String(raw.family ?? ''),
  }
}

// 永不抛出：任何形状问题都返回 { ok: false, error }，由调用方决定怎么告诉作者。
export function parsePrepResponse(raw: string): Ok | Fail {
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    return fail('模型没有返回合法 JSON')
  }
  if (!json || typeof json !== 'object') return fail('返回值不是对象')
  const genre: Genre = ['narrative', 'expository', 'other'].includes(json.genre) ? json.genre : 'other'
  const rawTargets = Array.isArray(json.targets) ? json.targets : []
  if (rawTargets.length === 0) return fail('一条靶心都没有')
  const targets: Target[] = []
  for (let i = 0; i < rawTargets.length; i++) {
    const t = parseTarget(rawTargets[i], genre, i)
    if (isFail(t)) return t
    targets.push(t)
  }
  targets.sort((a, b) => a.priority - b.priority)
  return { ok: true, value: { genre, genreReason: String(json.genre_reason ?? ''), targets } }
}
