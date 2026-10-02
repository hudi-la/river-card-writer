// 备料的服务端薄壳。刻意什么业务逻辑都不做——拼提示词和校验返回值全在
// src/prep/ 里作为纯函数（那些要能用 vitest 测），这里只负责收 HTTP、加 key、
// 转发、回传原文。网络这一层薄到不值得测。
//
// 它管两件事，各有各的必须在服务端做的理由：
//
//   kind: 'model'  —— 调模型。站点公开部署在 card-writer.pages.dev，API key
//                     绝不能进前端 bundle。Edge Function 默认验 Supabase 登录态。
//
//   kind: 'ngram'  —— 查语料。books.google.com/ngrams/json **不返回
//                     Access-Control-Allow-Origin**，浏览器直连一律被 CORS 拦掉。
//                     若放在前端，每个词都会变成"未查证"、徽章沦为纯噪音——
//                     那比没有徽章更糟。这一条是上线前实测发现的，别挪回前端。
//
// 部署：npx supabase functions deploy prep
// 设 key：npx supabase secrets set GEMINI_API_KEY=...
// 换模型：npx supabase secrets set PREP_MODEL=gemini-3.1-pro-preview

// 模型候选链。这些 503「high demand」不是异常而是常态——开发期间在这几个模型
// 之间轮着试才拿得到响应。只挑一个模型就意味着作者点一次「备料」全章都失败、
// 功能看起来是坏的。
// PREP_MODEL 设了就排最前，后面几个是退路；都是这个 key 实测可用的。
const MODEL_CHAIN = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-flash-latest',
]

// 每个模型最多等一次再重试；再不行就换下一个。
const RETRY_DELAY_MS = 1500

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 值得换个模型再试的状态码：429（额度/限流）和一切 5xx（过载、瞬时故障）。
// 4xx 里除 429 之外的（请求本身有问题）换模型也没用，直接抛回去。
function worthRetrying(status: number): boolean {
  return status === 429 || status >= 500
}

// 同时最多打几个 Ngrams 请求。它是非官方端点，别把它打挂；一章的候选词量级
// 在几十个，4 路并发足够快。
const NGRAM_CONCURRENCY = 4

// 浏览器跨域调用 Edge Function 会先发 OPTIONS 预检。不回 CORS 头的话，
// supabase-js 的 functions.invoke 在预检那一步就失败，前端只看到一个含糊的
// 网络错误——所以每个响应都得带上，OPTIONS 也要单独答。
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

// 逐字对应 src/prep/verify.ts 里注释描述的取数方式：近十年的平均频率。
// 三个盲区（≤5 词、语料截止 2019、只有书面语）记在那一侧。
async function ngramFreq(form: string): Promise<number | null> {
  const url =
    'https://books.google.com/ngrams/json?content=' +
    encodeURIComponent(form) +
    '&year_start=1980&year_end=2019&corpus=en-2019&smoothing=3'
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const j = await r.json()
    if (!Array.isArray(j) || j.length === 0) return null
    const ts = j[0]?.timeseries
    if (!Array.isArray(ts) || ts.length === 0) return null
    const recent = ts.slice(-10)
    return recent.reduce((a: number, b: number) => a + b, 0) / recent.length
  } catch {
    return null
  }
}

// 短语的第一个词。英语里动词短语的信息量基本都在它身上。
function headWord(form: string): string {
  return form.trim().split(/[\s,]+/)[0] ?? ''
}

// 每个词形返回两个数：整体搭配的频率，和词头的频率。
//
// 为什么要补查词头：模型给的候选常常本身就是带代词/介词的短语
// （enmeshed within it），整体当然查不到——可 enmeshed 是 7.9e-07 的常见词。
// 只看整体的话一整栏好词会被集体标成可疑，徽章就废了。
// 但也不能拿词头的频率冒充整体：那会让生造的搭配蒙混过关（pace the beat →
// pace 很常见）。所以两个数都给回去，由前端分出"词常见、搭配未见"这一档。
async function handleNgram(forms: unknown): Promise<Response> {
  if (!Array.isArray(forms)) return json({ error: 'forms 必须是数组' }, 400)
  const list = forms.filter((f): f is string => typeof f === 'string' && f.trim() !== '').slice(0, 200)
  const out: Record<string, { full: number | null; head: number | null }> = {}

  // 先把所有要查的 n-gram 摊平去重：整体 + 多词形的词头。省掉重复请求。
  const needed = new Set<string>()
  for (const form of list) {
    needed.add(form)
    const h = headWord(form)
    if (h && h !== form) needed.add(h)
  }
  const unique = Array.from(needed)
  const freq = new Map<string, number | null>()
  for (let i = 0; i < unique.length; i += NGRAM_CONCURRENCY) {
    const batch = unique.slice(i, i + NGRAM_CONCURRENCY)
    const got = await Promise.all(batch.map(ngramFreq))
    batch.forEach((f, k) => freq.set(f, got[k]))
  }

  for (const form of list) {
    const h = headWord(form)
    out[form] = {
      full: freq.get(form) ?? null,
      head: h && h !== form ? (freq.get(h) ?? null) : (freq.get(form) ?? null),
    }
  }
  return json({ freqs: out })
}

async function handleModel(system: unknown, user: unknown): Promise<Response> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: '服务端没有配置 GEMINI_API_KEY' }, 500)
  if (typeof system !== 'string' || typeof user !== 'string' || !system || !user) {
    return json({ error: '缺 system 或 user' }, 400)
  }
  // PREP_MODEL 排最前，其余候选跟在后面（去重）。
  const preferred = Deno.env.get('PREP_MODEL')
  const chain = Array.from(new Set([...(preferred ? [preferred] : []), ...MODEL_CHAIN]))

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    // 输出是清单不是稿子，又短又便宜，所以不需要流式。
    generationConfig: { responseMimeType: 'application/json', temperature: 1 },
  })

  let lastStatus = 0
  let lastDetail: unknown = null

  for (const model of chain) {
    // 每个模型给两次机会（过载往往几秒就恢复），之后换下一个。
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body }
      )
      const j = await r.json().catch(() => null)
      if (r.ok) {
        const text =
          j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
        // 空回复也算这个模型没干成活，换下一个试。
        if (text) return json({ text, model })
        lastStatus = 502
        lastDetail = { reason: '模型返回空内容', model }
        break
      }
      lastStatus = r.status
      lastDetail = j
      if (!worthRetrying(r.status)) {
        // 请求本身有问题，换模型也救不了。
        return json({ error: `模型返回 ${r.status}`, detail: j }, 502)
      }
      if (attempt === 1) await sleep(RETRY_DELAY_MS)
    }
  }

  return json(
    { error: `所有候选模型都没答上来（最后一次 ${lastStatus}）`, detail: lastDetail, tried: chain },
    502
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  let body: { kind?: string; system?: unknown; user?: unknown; forms?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }
  if (body.kind === 'ngram') return handleNgram(body.forms)
  if (body.kind === 'model') return handleModel(body.system, body.user)
  return json({ error: `不认识的 kind：${String(body.kind)}` }, 400)
})
