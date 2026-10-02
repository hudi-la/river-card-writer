import { useRef } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import { autoCardColor } from './schema'
import { isStale, isValidEn, zhFingerprint, ZH_JOIN } from './enText'
import { prepHitCount } from './prepHighlight'

// 一段英文 = 一个 <textarea>。
//
// 原来这里用的是裸 contentEditable 的 <div>，那是个错误的选择，直接造成两个
// 真 bug：
//   1. 按回车时浏览器往 DOM 里塞 <div>/<br>，那些行根本不在数据模型里，
//      于是删不掉也存不下。
//   2. contentEditable 的粘贴是带格式的 HTML，字号字体整个被带进来；而保存
//      时用 textContent 压成纯文本——看到的和存下来的是两回事。
//
// 数据模型是 string[]（每段一个纯字符串），那对应的 DOM 原语就是 textarea：
// HTML 进不来、字号带不进来、删除和回车都是原生行为，一行清洗代码都不用写。
//
// 非受控 + 失焦写回：受控组件每次击键都要重渲染，容易跟光标打架；而写回发生
// 在失焦之后，那时焦点已经离开，不会把正在打字的位置冲掉。
//
// 高度走纯 CSS（外层 .card-en-cell 的 ::after 复制同一份文字当影子，把格子
// 撑到真实高度），不用 JS 量。原来用的是 el.scrollHeight——而 .card-en 平时是
// display:none，textarea 在隐藏状态下挂载时 scrollHeight 读出来是 0，高度就被
// 钉死成一行；开关备料边栏导致栏宽变化时同样会失准。
// 任何"量一次就记住"的做法在这里都会过期，CSS 不会。
function EnCell({
  value,
  style,
  index,
  placeholder,
  onCommit,
}: {
  value: string
  style: string
  index: number
  placeholder?: string
  onCommit: (text: string) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)

  return (
    <div className="card-en-cell" ref={wrap} data-value={value}>
      <textarea
        className="card-en-p"
        data-style={style}
        aria-label={`第 ${index + 1} 段的英文`}
        defaultValue={value}
        rows={1}
        spellCheck
        placeholder={placeholder}
        // 高度由外层那个影子元素（::after 复制同一份文字）撑开，这里只负责
        // 把当前值同步过去。不读 scrollHeight、不量任何东西。
        onInput={(e) => {
          if (wrap.current) wrap.current.dataset.value = e.currentTarget.value
        }}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        // CRITICAL：拦住事件，别让它们冒到 ProseMirror 的根上去。
        // 这个 textarea 在 PM 可编辑区内部（靠 aside 的 contentEditable={false}
        // 隔开），但 DOM 事件照样会冒泡；PM 的 keymap 抓 Backspace / Enter 等键，
        // 那是原来"英文格子里删不掉行"的另一半原因。
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

  // 脏 en（段数不符、形状不对）一律当没写过。JSON 路径不走 schema 的 parseHTML，
  // 所以这里必须再兜一层——渲染一份跟中文对不上的英文比什么都不显示更有害。
  const rawEn = node.attrs.en
  const en: string[] | null = isValidEn(rawEn, zhTexts.length) ? rawEn : null
  const stale = isStale(en, node.attrs.enSrc || '', zhTexts.join(ZH_JOIN))

  // 写回一段英文。只在 blur 时调用——写回会让这个 node view 重渲染，那时焦点
  // 已经离开，所以不会把作者正在打字的光标冲掉。
  function commit(index: number, text: string) {
    const next = en ? [...en] : zhTexts.map(() => '')
    if (next[index] === text) return
    next[index] = text
    // 全空 = 退回"没写过"，而不是存一个全是空串的数组
    const anyText = next.some((s) => s.trim() !== '')
    updateAttributes({
      en: anyText ? next : null,
      enSrc: anyText ? zhFingerprint(zhTexts) : '',
      enAt: anyText ? new Date().toISOString() : '',
    })
  }

  // 这张卡有几条靶心。跟装饰器同一个来源，所以正文里高亮几处、这里就说几条。
  const hitCount = cardId ? prepHitCount(editor, cardId) : 0

  return (
    <NodeViewWrapper
      as="section"
      className="card"
      data-card-id={cardId || undefined}
      data-color={color || undefined}
      data-en-stale={stale ? 'true' : undefined}
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
        {stale ? <p className="card-en-stale-note">中文改过，这段英文已过期</p> : null}
        {en == null && hitCount > 0 ? (
          <p className="card-en-hint">{hitCount} 个靶心在右栏 →</p>
        ) : null}
        {zhTexts.map((_, i) => (
          <EnCell
            // key 带上当前值：外部改动（切卡/合卡重算了 en）时整个换一个，
            // 从而刷新 defaultValue。打字期间不会触发——我们只在失焦时写回。
            key={`${cardId ?? 'n'}-${i}-${en ? en[i] : ''}`}
            value={en ? en[i] : ''}
            style={zhStyles[i]}
            index={i}
            placeholder={en == null && i === 0 ? '还没写' : undefined}
            onCommit={(text) => commit(i, text)}
          />
        ))}
      </aside>
    </NodeViewWrapper>
  )
}
