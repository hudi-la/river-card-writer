import type { AiPolicy, Genre, Target } from '../prep/types'
import type { Tier } from '../prep/verify'

const TIER_LABEL: Record<Tier, string> = { ok: '已查证', rare: '罕用', unverified: '未查证' }
const GENRE_LABEL: Record<Genre, string> = { narrative: '叙事', expository: '议论', other: '其他' }
const POLICY_LABEL: Record<AiPolicy, string> = { strict: '只给词', auto: '给译文' }

// 展开几条。前两条通常是承重句和歧义那一类（priority 已经排过序），值得占地方；
// 其余折起来，否则一张卡五六条全展开边栏就是一堵墙。
const EXPANDED = 2

// 三档徽章。靠形状 + 明度区分，不只靠颜色——未查证的那个是空心环、候选名还带
// 删除线，即使看不出颜色差别也认得出来。
function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className="prep-tier" data-tier={tier}>
      {TIER_LABEL[tier]}
      {tier === 'unverified' ? ' · 语料里查不到' : null}
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
  aiPolicy = 'strict',
  onPolicyChange,
  translation,
  onClose,
}: {
  targets: Target[]
  genre: Genre
  tiers: Map<string, Tier>
  busy?: boolean
  progress?: { done: number; total: number } | null
  onPrepCard?: () => void
  aiPolicy?: AiPolicy
  onPolicyChange?: (p: AiPolicy) => void
  translation?: string[]
  onClose?: () => void
}) {
  return (
    <aside className="prep-sidebar">
      {/* 一行表头：左标题、右文体条数。原来我把标题另起一行压在这上面，
          于是边栏顶上出现两行 chrome——那就是页面上看着重复的东西。 */}
      <header className="prep-head">
        <span className="prep-title">备料 · 当前这张卡</span>
        <span className="prep-meta">
          {busy
            ? progress && progress.total > 1
              ? `备料中 ${progress.done}/${progress.total}`
              : '备料中…'
            : `${GENRE_LABEL[genre]} · ${targets.length} 条`}
        </span>
        {targets.length > 0 && !busy && onPrepCard ? (
          <button className="prep-redo" onClick={onPrepCard} title="重新备这张卡">
            重备
          </button>
        ) : null}
        {onClose ? (
          <button className="prep-close" onClick={onClose} title="收起备料" aria-label="收起备料">
            ×
          </button>
        ) : null}
      </header>

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

      {targets.length === 0 && !busy ? (
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

      {targets.slice(0, EXPANDED).map((t, i) => (
        <section className="prep-target" key={`${t.zh}-${i}`}>
          <h3 className="prep-zh">
            {t.zh}
            {t.family ? <span className="prep-family">族 · {t.family}</span> : null}
            {t.noSingleWord ? <span className="prep-nosingle">英文没有对应单词</span> : null}
          </h3>

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
              const tier = tiers.get(c.verifyForm) ?? 'unverified'
              return (
                <li className="prep-cand" key={c.en} data-tier={tier}>
                  <div className="prep-cand-head">
                    <span className="prep-en">{c.en}</span>
                    <TierBadge tier={tier} />
                    {c.register ? <span className="prep-register">{c.register}</span> : null}
                  </div>
                  {c.nuance ? <p className="prep-nuance">{c.nuance}</p> : null}
                  {/* 每个候选都必须说出它丢了什么。没有任何候选可以只有优点——
                      结构上就不可能出现"这个是完美的对应"。 */}
                  <p className="prep-loses">丢了 · {c.loses}</p>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {/* 只展开前 EXPANDED 条；其余在下面折成一行。 */}
      {targets.slice(EXPANDED).map((t, i) => (
        <details className="prep-collapsed" key={`c-${t.zh}-${i}`}>
          <summary>
            <span className="prep-zh-sm">{t.zh}</span>
            {t.candidates.map((c) => (
              <span className="prep-chip" key={c.en} data-tier={tiers.get(c.verifyForm) ?? 'unverified'}>
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
          <ul className="prep-cands">
            {t.candidates.map((c) => (
              <li className="prep-cand" key={c.en} data-tier={tiers.get(c.verifyForm) ?? 'unverified'}>
                <div className="prep-cand-head">
                  <span className="prep-en">{c.en}</span>
                  <TierBadge tier={tiers.get(c.verifyForm) ?? 'unverified'} />
                </div>
                {c.nuance ? <p className="prep-nuance">{c.nuance}</p> : null}
                <p className="prep-loses">丢了 · {c.loses}</p>
              </li>
            ))}
          </ul>
        </details>
      ))}

    </aside>
  )
}
