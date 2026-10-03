import { useRef } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import { autoCardColor } from './schema'
import { useBookStore } from '../state/bookStore'
import {
  confirmState,
  enToText,
  isValidEn,
  textToEn,
  UNCONFIRMED,
  zhFingerprint,
  ZH_JOIN,
} from './enText'
import { prepHitCount } from './prepHighlight'

// 一张卡的英文 = 一个 <textarea>。空行分段。
//
// 为什么不是"一段一个盒子"：原来是，那是为了跟中文逐段对应。作者 2026-10-02
// 指出那个理由已经不存在了——段数不锁 1:1 了，行内标记在纯文本里本来就进不去，
// 确认也早就是手动按钮。而拆成一段一格要付的代价是实打实的：textarea 的选区
// 只存在于它自己内部，原生选择跨不过两个 textarea，所以作者想把上下两块一起
// 选中拿去别处看一眼都做不到。一卡一格之后，整张卡的英文能自由拖选、复制。
//
// 为什么是 textarea 而不是 contentEditable：后者试过，造成两个真 bug——Enter
// 插出的 DOM 节点不在模型里（删不掉、存不下），粘贴把别处的字号和 HTML 带进
// 正文。textarea 从结构上就只装纯文本。
//
// 非受控 + 失焦写回：受控组件每次击键都要重渲染，容易跟光标打架；写回发生在
// 失焦之后，那时焦点已经离开，不会把正在打字的位置冲掉。
//
// 高度走纯 CSS（外层 .card-en-cell 的 ::after 复制同一份文字当影子，把它撑到
// 真实高度），不用 JS 量。原来用的是 el.scrollHeight——而 .card-en 平时是
// display:none，textarea 在隐藏状态下挂载时 scrollHeight 读出来是 0，高度就被
// 钉死成一行；开关备料边栏导致栏宽变化时同样会失准。
// 任何"量一次就记住"的做法在这里都会过期，CSS 不会。
function EnField({
  value,
  style,
  placeholder,
  onCommit,
}: {
  value: string
  style: string
  placeholder?: string
  onCommit: (text: string) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)

  return (
    <div className="card-en-cell" ref={wrap} data-value={value}>
      <textarea
        className="card-en-p"
        data-style={style}
        aria-label="这张卡的英文"
        defaultValue={value}
        rows={1}
        spellCheck
        placeholder={placeholder}
        onInput={(e) => {
          if (wrap.current) wrap.current.dataset.value = e.currentTarget.value
        }}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        // CRITICAL：拦住事件，别让它们冒到 ProseMirror 的根上去。
        // 这个 textarea 在 PM 可编辑区内部（靠 aside 的 contentEditable={false}
        // 隔开），但 DOM 事件照样会冒泡；PM 的 keymap 抓 Backspace / Enter 等键，
        // 那是原来"英文格子里删不掉行"的另一半原因。
        // Enter 不用再特殊处理：一卡一格，回车就是回车，空行就是分段。
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onCut={(e) => e.stopPropagation()}
        onDragStart={(e) => e.stopPropagation()}
      />
    </div>
  )
}

// 每张卡的渲染：一个 section.card（背景色 = 手动设的 color，或者按 cardId 稳定哈希
// 出的默认色）+ 中文正文 + 英文栏 + 一个纯视觉的拖拽把手（GripVertical，跟阅读陪伴
// app 同一套 Lucide 线性图标）。把手本身是 pointer-events:none（见 styles.css
// .card-drag-handle）——拖拽命中判定/真正的拖拽逻辑都在 RiverEditor 里。
//
// 英文栏（aside.card-en）始终渲染，由 .river--bilingual 这个祖先 class 决定显不显示。
// 刻意不通过 props 把"双语模式"传进 node view——那在 TipTap 里要走 editor.storage
// 或强制重建 node view，代价大且容易出 bug；一个 CSS class 就够。
//
// 卡片本身是两列 grid（见 styles.css），所以中英按卡天然对齐、只有一个滚动条，
// 不需要任何滚动同步代码。这是"英文住在中文卡片里"这个存储决定换来的红利。
export function CardView({ node, updateAttributes, editor }: NodeViewProps) {
  const cardId: string | null = node.attrs.cardId
  const color: string | null = node.attrs.color
  const bg = color || autoCardColor(cardId ?? '')
  const style = { ['--card-bg' as any]: bg } as React.CSSProperties

  // 每段中文的文本与样式。英文不存自己的段落样式——按序号从这里继承。
  const zhTexts: string[] = []
  const zhStyles: string[] = []
  node.forEach((p) => {
    zhTexts.push(p.textContent)
    zhStyles.push(p.attrs.style || 'body')
  })

  // 形状不对（不是字符串数组）才当没写过。**段数对不上不算不合格**——
  // 作者删掉一段中文时英文不该跟着消失，更不该在他下次敲字时被空串覆盖。
  const rawEn = node.attrs.en
  const en: string[] | null = isValidEn(rawEn) ? rawEn : null
  const state = confirmState(en, node.attrs.enSrc || '', zhTexts.join(ZH_JOIN))

  // 写回这张卡的英文。只在 blur 时调用——写回会让这个 node view 重渲染，那时
  // 焦点已经离开，所以不会把作者正在打字的光标冲掉。
  function commit(text: string) {
    const next = textToEn(text)
    const anyText = next.length > 0
    if (enToText(en) === enToText(anyText ? next : null)) return
    updateAttributes({
      en: anyText ? next : null,
      // CRITICAL：写回只存文字，绝不盖确认章。确认是作者的动作，只有他点
      // 「确认」时才盖（见 confirm）。改自己的英文不撤销确认——他是作者，
      // 修自己的字是在继续背书，不是在推翻。
      ...(anyText ? {} : { enSrc: UNCONFIRMED }),
      enAt: anyText ? new Date().toISOString() : '',
    })
  }

  // 作者认下这段英文：盖上当前中文的指纹。之后中文一变，指纹对不上，确认自动
  // 失效——不需要任何地方"记得去撤销"。
  function confirm() {
    updateAttributes({ enSrc: zhFingerprint(zhTexts), enAt: new Date().toISOString() })
    // 顺手学一次：这段他认下了，那就看看他真正用了哪些候选词。
    // 作者的主意，比原设计（打字时记录）准得多——写到一半又删掉的不算数。
    if (cardId && en) useBookStore.getState().recordConfirmedUse(cardId, en.join('\n'))
  }

  function unconfirm() {
    updateAttributes({ enSrc: UNCONFIRMED })
  }

  // 这张卡有几条靶心。跟装饰器同一个来源，所以正文里高亮几处、这里就说几条。
  const hitCount = cardId ? prepHitCount(editor, cardId) : 0

  return (
    <NodeViewWrapper
      as="section"
      className="card"
      data-card-id={cardId || undefined}
      data-color={color || undefined}
      data-en-state={state}
      style={style}
    >
      <span className="card-drag-handle" aria-hidden="true">
        <GripVertical size={14} strokeWidth={1.75} />
      </span>
      <NodeViewContent className="card-body" />
      {/* contentEditable={false} 把英文栏从 ProseMirror 的可编辑区里摘出来，
          否则 PM 会试图把这里的输入当成文档编辑。内层每格再单独开。 */}
      {/* contentEditable={false} 把英文栏从 ProseMirror 的可编辑区里摘出来，
          否则 PM 会试图把这里的输入当成文档编辑。 */}
      <aside className="card-en" contentEditable={false}>
        {state === 'invalidated' ? (
          <p className="card-en-note" data-kind="invalidated">
            中文改过，之前的确认已失效
          </p>
        ) : null}
        {en == null && hitCount > 0 ? (
          <p className="card-en-hint">{hitCount} 个靶心在右栏 →</p>
        ) : null}
        {/* 块样式：整张卡只有一个段落时跟着它走（章/节这类标题卡就是这种），
            否则一律按正文。一卡一格之后不可能再逐段继承——textarea 里没有
            "段"这个东西可供单独上样式。 */}
        <EnField
          // key 带上当前值：外部改动（切卡/合卡重算了 en）时整个换一个，从而
          // 刷新 defaultValue。打字期间不会触发——我们只在失焦时写回。
          key={`${cardId ?? 'n'}-${enToText(en)}`}
          value={enToText(en)}
          style={zhStyles.length === 1 ? zhStyles[0] : 'body'}
          placeholder={en == null ? '开始写…' : undefined}
          onCommit={commit}
        />
        {state !== 'unwritten' ? (
          <div className="card-en-confirm">
            {state === 'confirmed' ? (
              <button type="button" className="is-confirmed" onClick={unconfirm} title="撤回确认">
                ✓ 你确认过这一段
              </button>
            ) : (
              <button type="button" onClick={confirm}>
                {state === 'invalidated' ? '重新确认' : '确认这一段'}
              </button>
            )}
          </div>
        ) : null}
      </aside>
    </NodeViewWrapper>
  )
}
