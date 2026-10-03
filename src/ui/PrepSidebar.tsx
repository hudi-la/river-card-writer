import type { AiPolicy, Genre, Target } from '../prep/types'
import type { Tier } from '../prep/verify'

// 徽章只在有话说的时候才出声。
//
// 作者点破的那件事：模型捞出来的本来就是他不熟的词，再去标"这个词常不常见"
// 等于在回答一个他从没问过的问题——常见的词他当然认得。所以查到了的一律不标，
// 整栏干干净净；只有真的在语料里找不到、也就是可能被模型造出来的那种，才值得
// 占一个徽章的位置。
const TIER_LABEL: Partial<Record<Tier, string>> = {
  'not-found': '语料里没有这个词',
}

const GENRE_LABEL: Record<Genre, string> = { narrative: '叙事', expository: '议论', other: '其他' }
const POLICY_LABEL: Record<AiPolicy, string> = { strict: '只给词', auto: '给译文' }


// 三档徽章。靠形状 + 明度区分，不只靠颜色——未查证的那个是空心环、候选名还带
// 删除线，即使看不出颜色差别也认得出来。
function TierBadge({ tier }: { tier: Tier }) {
  const label = TIER_LABEL[tier]
  if (!label) return null // 查到了就什么都不说——沉默才是常态
  return (
    <span className="prep-tier" data-tier={tier}>
      {label}
    </span>
  )
}

// 右侧固定边栏：显示光标所在那张卡的备料。纯展示组件，所有数据都从 props 来，
// 所以能脱离编辑器单独测。
//
// 布局是「两栏 + 一条边栏」而不是真三栏：三栏等宽后中文英文都只剩三四十字宽，
// 而那两栏才是作者反复比对的主力。边栏位置固定，眼睛不用找；提词再长也撑不散河流。
export function PrepSidebar({
  targets,
  genre,
  tiers,
  busy = false,
  progress = null,
  onPrepCard,
  usedWords,
  error = null,
  warnings = [],
  aiPolicy = 'strict',
  onPolicyChange,
  translation,
}: {
  targets: Target[]
  genre: Genre
  tiers: Map<string, Tier>
  busy?: boolean
  progress?: { done: number; total: number } | null
  onPrepCard?: () => void
  // 作者确认过的段落里真正出现过的候选词。标出来，下次遇到就知道这是他的词。
  usedWords?: Record<string, number>
  error?: string | null
  warnings?: string[]
  aiPolicy?: AiPolicy
  onPolicyChange?: (p: AiPolicy) => void
  translation?: string[]
}) {
  return (
    <aside className="prep-sidebar">
      {/* 表头只在备料中时出现。
          × 跟顶栏那个面板开关是同一件事，重复；「重备」几乎没人用——真要重算
          不如直接划词备那个具体的词。两个都去掉之后，表头平时就该是空的。 */}
      {busy ? (
        <header className="prep-head">
          <span className="prep-meta">
            {progress && progress.total > 1 ? `备料中 ${progress.done}/${progress.total}` : '备料中…'}
          </span>
        </header>
      ) : null}

      {/* 这份稿子允许 AI 做到哪一档。spec §9.4：这个开关设错了不会报错，等发现时
          稿子已经在对方手里，只能靠让状态一直在眼前来防——所以它常驻在这儿，
          不藏进设置页。 */}
      <div className="prep-policy-row">
        {onPolicyChange ? (
          <div className="policy-switch" role="group" aria-label="这份稿子允许 AI 做到哪一档">
            {(['strict', 'auto'] as AiPolicy[]).map((p) => (
              <button
                key={p}
                type="button"
                data-on={aiPolicy === p ? 'true' : undefined}
                data-policy={p}
                aria-pressed={aiPolicy === p}
                onClick={() => onPolicyChange(p)}
              >
                {POLICY_LABEL[p]}
              </button>
            ))}
          </div>
        ) : (
          <span className="policy-chip" data-ai-policy={aiPolicy}>{POLICY_LABEL[aiPolicy]}</span>
        )}
        <span className="prep-policy-note">
          {aiPolicy === 'strict' ? '只给词与语感，句子归你' : '额外给整句译文，只在这里当参考'}
        </span>
      </div>

      {/* 整句译文。刻意长得不像可以粘的东西：等宽、发灰、带一句提醒。
          它存在 hints 里，绝不进 en——en 只装作者自己敲的字（§9.1）。
          必须同时说清它保证不了什么：照着重打一遍，数据层看不出任何区别。 */}
      {aiPolicy === 'auto' && translation && translation.length > 0 ? (
        <section className="prep-translation">
          <h3>整句译文 · 参考</h3>
          {translation.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
          <p className="prep-translation-note">
            它不会进你的英文栏。照着重打一遍的话，文件层面看不出区别——那句话的来源就不是你了。
          </p>
        </section>
      ) : null}

      {busy && targets.length === 0 ? (
        <p className="prep-empty">
          一次模型调用大约半分钟到一分钟。整章是并发跑的，边跑边出结果——这期间你可以直接开始写英文，不用等它。
        </p>
      ) : null}

      {/* 失败留在界面上，不是闪一下就没。原来只有一个 5 秒的 toast，于是
          "失败了"和"从没试过"长得一模一样，作者既不知道发生过什么也看不到原因。 */}
      {error && !busy ? (
        <div className="prep-error">
          <p className="prep-error-head">上一次备料没成</p>
          <p className="prep-error-msg">{error}</p>
          {onPrepCard ? (
            <button className="prep-card-btn" onClick={onPrepCard}>
              再试一次
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 被丢掉的候选。不是错误——备料能用，只是少了几条；但作者有权知道，
          否则他会以为模型就只给了这么点。 */}
      {warnings.length > 0 && !busy ? (
        <details className="prep-warnings">
          <summary>有 {warnings.length} 条被丢掉了</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {targets.length === 0 && !busy && !error ? (
        <div className="prep-empty">
          <p>
            这张卡还没备料。模型会挑出中文里质感最重、最容易在英译中被压平的地方，为每处给几个词和它们的语感差别——句子由你自己写。
          </p>
          {onPrepCard ? (
            <button className="prep-card-btn" onClick={onPrepCard}>
              备这张卡
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 全部默认折起，要看哪条点哪条。
          折起来时标题行上留着靶心名和候选词，扫一眼就知道这张卡有哪些东西；
          真要看语感和缺点再展开。一张卡五六条全摊开的话边栏就是一堵墙。 */}
      {targets.map((t, i) => (
        <details
          className="prep-target"
          key={`${t.zh}-${i}`}
          data-by-author={t.byAuthor ? 'true' : undefined}
        >
          <summary>
            <span className="prep-zh">{t.zh}</span>
            {t.byAuthor ? <span className="prep-by-author">你要的</span> : null}
            {t.family ? <span className="prep-family">族 · {t.family}</span> : null}
            {t.noSingleWord ? <span className="prep-nosingle">英文没有对应单词</span> : null}
            {/* 折起来时在标题行上留下候选词，展开后由 CSS 藏掉——否则重复 */}
            {t.candidates.map((c) => (
              <span
                className="prep-chip"
                key={c.en}
                data-tier={tiers.get(c.verifyForm) ?? 'not-found'}
                data-used={usedWords?.[c.en.toLowerCase()] ? 'true' : undefined}
              >
                {c.en}
              </span>
            ))}
          </summary>

          {t.whyZhIsPrecise ? (
            <p className="prep-why">
              <span className="prep-label">中文准在 · </span>
              {t.whyZhIsPrecise}
            </p>
          ) : null}

          {t.flatTranslation.text ? (
            <p className="prep-flat">
              <strong>笼统译法 {t.flatTranslation.text}</strong>
              {t.flatTranslation.whyItDies ? ` — ${t.flatTranslation.whyItDies}` : null}
            </p>
          ) : null}

          <ul className="prep-cands">
            {t.candidates.map((c) => {
              const tier = tiers.get(c.verifyForm) ?? 'not-found'
              return (
                <li className="prep-cand" key={c.en} data-tier={tier}>
                  <div className="prep-cand-head">
                    <span className="prep-en">{c.en}</span>
                    <TierBadge tier={tier} />
                    {usedWords?.[c.en.toLowerCase()] ? (
                      <span className="prep-used" title="你在确认过的段落里用过它">
                        你用过{usedWords[c.en.toLowerCase()] > 1 ? ` ${usedWords[c.en.toLowerCase()]} 次` : ''}
                      </span>
                    ) : null}
                    {c.register ? <span className="prep-register">{c.register}</span> : null}
                  </div>
                  {c.nuance ? <p className="prep-nuance">{c.nuance}</p> : null}
                  {/* 每个候选都必须说出它丢了什么。没有任何候选可以只有优点——
                      结构上就不可能出现"这个是完美的对应"。 */}
                  <p className="prep-loses">
                    <span className="prep-loses-label">短处</span>
                    {c.loses}
                  </p>
                </li>
              )
            })}
          </ul>
        </details>
      ))}

    </aside>
  )
}
