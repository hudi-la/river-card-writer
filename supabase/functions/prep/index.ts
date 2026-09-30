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

const DEFAULT_MODEL = 'gemini-3.5-flash'

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

async function handleNgram(forms: unknown): Promise<Response> {
  if (!Array.isArray(forms)) return json({ error: 'forms 必须是数组' }, 400)
  const list = forms.filter((f): f is string => typeof f === 'string' && f.trim() !== '').slice(0, 200)
  const out: Record<string, number | null> = {}
  for (let i = 0; i < list.length; i += NGRAM_CONCURRENCY) {
    const batch = list.slice(i, i + NGRAM_CONCURRENCY)
    const freqs = await Promise.all(batch.map(ngramFreq))
    batch.forEach((form, k) => {
      out[form] = freqs[k]
    })
  }
  return json({ freqs: out })
}

async function handleModel(system: unknown, user: unknown): Promise<Response> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: '服务端没有配置 GEMINI_API_KEY' }, 500)
  if (typeof system !== 'string' || typeof user !== 'string' || !system || !user) {
    return json({ error: '缺 system 或 user' }, 400)
  }
  const model = Deno.env.get('PREP_MODEL') ?? DEFAULT_MODEL
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        // 输出是清单不是稿子，又短又便宜，所以不需要流式。
        generationConfig: { responseMimeType: 'application/json', temperature: 1 },
      }),
    }
  )
  const j = await r.json()
  if (!r.ok) return json({ error: `模型返回 ${r.status}`, detail: j }, 502)
  const text =
    j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  if (!text) return json({ error: '模型没有返回内容' }, 502)
  return json({ text })
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
