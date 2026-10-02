import type { AiPolicy, Candidate, Genre, PrepResult, Target } from './types'

// 「我没有缺点」的各种说法。模型倾向于用这些糊过去，一律当成没填。
const EMPTY_LOSES = new Set(['', '无', '没有', 'n/a', 'na', 'none', '—', '-', '不适用'])

// 判断一个字段里是不是塞进了整句英文。
//
// CRITICAL：数的是**最长一段连续英文**，不是全文英文词数。原来按总数算，
// 而中文学术文体的语感说明里本来就夹满英文术语（relational strategy、
// attachment theory……），散落的术语加起来轻易就过 8 个——那是个假警报
// 制造机，而且代价很重：一条候选被误判，整张卡的备料全被拒收。
// 句子的特征是"连续"，不是"总量"。
function looksLikeSentence(s: string): boolean {
  if (/[.!?]\s+[A-Z]/.test(s)) return true
  const runs = s.match(/[A-Za-z][A-Za-z'’-]*(?:[ ,]+[A-Za-z][A-Za-z'’-]*)*/g) ?? []
  return runs.some((run) => run.split(/[ ,]+/).filter(Boolean).length >= 8)
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

type Fail = { ok: false; error: string }
// warnings = 被丢掉的候选/靶心及其原因。不是错误——备料照常可用，只是少了几条。
type Ok = { ok: true; value: PrepResult; warnings: string[] }

function fail(error: string): Fail {
  return { ok: false, error }
}

// 返回 null = 这条候选不合格，丢掉它（原因记进 warnings）。
// 刻意不再整份拒收：一条候选的 verify_form 写长了，不该让作者失去整张卡的
// 备料——那次调用花了半分钟和真金白银。只有安全相关的问题才硬拒（见
// parsePrepResponse 里对 translation 的处理）。
function parseCandidate(raw: any, where: string, warnings: string[]): Candidate | null {
  const drop = (why: string) => {
    warnings.push(`${where}：${why}`)
    return null
  }
  if (!raw || typeof raw !== 'object') return drop('有一条候选不是对象，已丢弃')
  const loses = typeof raw.loses === 'string' ? raw.loses : ''
  if (EMPTY_LOSES.has(loses.trim().toLowerCase())) {
    return drop(`候选「${raw.en}」没说它丢了什么，已丢弃（没有任何候选可以只有优点）`)
  }
  const verifyForm = typeof raw.verify_form === 'string' ? raw.verify_form.trim() : ''
  if (!verifyForm) return drop(`候选「${raw.en}」缺 verify_form，已丢弃`)
  if (wordCount(verifyForm) > 5) {
    return drop(`候选「${raw.en}」的 verify_form 太长（${verifyForm}），语料里查不到、会误报成未查证，已丢弃`)
  }
  for (const [field, v] of [
    ['nuance', raw.nuance],
    ['loses', loses],
    ['why_fits', raw.why_fits],
  ] as const) {
    if (typeof v === 'string' && looksLikeSentence(v)) {
      return drop(`候选「${raw.en}」的 ${field} 里出现了整句英文，已丢弃`)
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

// 返回 null = 这条靶心不合格（候选全被丢光了），丢掉它。
function parseTarget(raw: any, genre: Genre, i: number, warnings: string[]): Target | null {
  const where = `第 ${i + 1} 条靶心`
  if (!raw || typeof raw !== 'object') {
    warnings.push(`${where}：不是对象，已丢弃`)
    return null
  }
  // 承重句只存在于议论/学术文体。叙事文没有论点句——模型曾经借这个分类表达
  // "这条最重要"，那是 priority 的活。分类错了不值得丢掉整条，改掉就是。
  let category = String(raw.category ?? '')
  if (category === '承重句' && genre !== 'expository') {
    warnings.push(`${where}：${genre} 文体不该有「承重句」分类，已改成普通条目`)
    category = '动作质感'
  }
  const rawCands = Array.isArray(raw.candidates) ? raw.candidates : []
  const candidates: Candidate[] = []
  for (const rc of rawCands) {
    const c = parseCandidate(rc, where, warnings)
    if (c) candidates.push(c)
  }
  if (candidates.length === 0) {
    warnings.push(`${where}：候选一条都不合格，整条已丢弃`)
    return null
  }
  const ft = raw.flat_translation ?? {}
  return {
    zh: String(raw.zh ?? ''),
    zhQuote: String(raw.zh_quote ?? ''),
    category,
    priority: Number.isFinite(raw.priority) ? Number(raw.priority) : 3,
    whyZhIsPrecise: String(raw.why_zh_is_precise ?? ''),
    flatTranslation: { text: String(ft.text ?? ''), whyItDies: String(ft.why_it_dies ?? '') },
    candidates,
    noSingleWord: raw.no_single_word === true,
    family: String(raw.family ?? ''),
  }
}

// 永不抛出：任何形状问题都返回 { ok: false, error }，由调用方决定怎么告诉作者。
//
// policy 决定校验的严格程度，这是 §9.2 那道墙的落点：
//   strict —— 返回值里出现 translation 一律拒收。不是忽略、是拒收；模型若
//             试图夹带成句，作者会看到明确的错误而不是悄悄收下。
//   auto   —— 接受 translation，但仍要求段数与中文一一对应。
export function parsePrepResponse(raw: string, policy: AiPolicy = 'strict'): Ok | Fail {
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    return fail('模型没有返回合法 JSON')
  }
  if (!json || typeof json !== 'object') return fail('返回值不是对象')
  const genre: Genre = ['narrative', 'expository', 'other'].includes(json.genre) ? json.genre : 'other'
  const rawTargets = Array.isArray(json.targets) ? json.targets : []
  if (rawTargets.length === 0) return fail('模型一条靶心都没给')
  const warnings: string[] = []
  const targets: Target[] = []
  for (let i = 0; i < rawTargets.length; i++) {
    const t = parseTarget(rawTargets[i], genre, i, warnings)
    if (t) targets.push(t)
  }
  // 只有全军覆没才硬拒——留一条是一条，那次调用花了半分钟和真钱。
  if (targets.length === 0) {
    return fail(`模型给的 ${rawTargets.length} 条靶心没有一条合格：${warnings[0] ?? '形状不对'}`)
  }
  targets.sort((a, b) => a.priority - b.priority)

  const hasTranslation = json.translation !== undefined && json.translation !== null
  if (policy === 'strict' && hasTranslation) {
    return fail('这份稿子是「只给词」档，但模型夹带了整句译文——已拒收。')
  }
  let translation: string[] | undefined
  if (policy === 'auto' && hasTranslation) {
    if (!Array.isArray(json.translation) || !json.translation.every((x: unknown) => typeof x === 'string')) {
      return fail('译文必须是每段一个字符串的数组')
    }
    translation = json.translation as string[]
  }

  return {
    ok: true,
    value: {
      genre,
      genreReason: String(json.genre_reason ?? ''),
      targets,
      ...(translation ? { translation } : {}),
    },
    warnings,
  }
}
