import { useEffect, useRef } from 'react'
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'
import { GripVertical } from 'lucide-react'
import { autoCardColor } from './schema'
import { useBookStore } from '../state/bookStore'
import {
  confirmState,
  enToText,
  isValidEn,
  paragraphsToHtml,
  readParagraphs,
  UNCONFIRMED,
  zhFingerprint,
  ZH_JOIN,
} from './enText'
import { prepHitCount } from './prepHighlight'

// 一张卡的英文 = 一组真的 <p>。
//
// 为什么是 contenteditable 而不是 textarea：作者要每段首行缩进，跟中文栏一致。
// text-indent 作用于一个块盒的第一行，而一个 textarea 不管里面有多少换行都只是
// **一个**块盒——第二段的首行在 CSS 里根本不存在，没法单独上样式。要 per 段
// 缩进，这一栈就必须是真的段落元素。
//
// 换过来要付的代价，和各自的防线（2026-10-02 跟作者讲清楚过）：
//
//   1. 光标可能被重渲染踢回开头。React 不管 contenteditable 的子节点，任何一次
//      碰到内容的重渲染都会。防线：innerHTML 只在挂载时写一次，打字期间绝不碰；
//      外部改动（切卡/合卡重算了 en）靠 key 带签名整个换一个，跟原来 textarea
//      的 defaultValue 刷新是同一个机制。
//   2. ProseMirror 可能来抢选区。英文栏靠 aside 的 contentEditable={false} 隔在
//      PM 可编辑区外，但塞一个真能编辑的子节点进去，"选区归谁"是有歧义的。
//      防线：键盘/输入/粘贴事件一律 stopPropagation，不让 PM 的 keymap 看见。
//   3. Cmd+Z 会和 PM 的历史打架。没有干净的防线——用 execCommand 插入粘贴内容
//      是为了至少留在浏览器的原生撤销栈里。
//
// 为什么是 contenteditable="true" 而不是 "plaintext-only"：试过后者，不行。在
// plaintext-only 下回车插进去的是一个**字符级的 \n**，留在同一个 <p> 里——整栈
// 仍然只是一个块盒，跟 textarea 没有区别，每段缩进照样做不到（2026-10-02 在真
// 浏览器里实测确认）。'true' 下回车会把当前 <p> 切成两个真的 <p>，每段才各自
// 拿到首行缩进。代价是富文本命令和带格式的粘贴有了入口，所以下面两道闸是
// **必须**的，不是保险：粘贴只取 text/plain；Cmd+B/I/U 直接拦掉。
// 真有东西漏进来，readParagraphs 只读文字，写回时也只会存下纯文本。
//
// 读回来按块走 DOM（readParagraphs），不是 textContent。这条是当初裸 contenteditable
// 真出 bug 的地方：textContent 把回车产生的块边界吃掉，所以看到的换行从没被存下来。
// 往返相等有测试直接跑（见 enText.test.ts）。
//
// 非受控 + 失焦写回：跟原来一样。写回发生在失焦之后，不会冲掉正在打字的位置。
// 高度不用再操心——真段落自然撑开，原来那套 ::after 影子测高的土办法可以不要了。
function EnField({
  paragraphs,
  style,
  placeholder,
  onCommit,
}: {
  paragraphs: string[]
  style: string
  placeholder?: string
  onCommit: (paragraphs: string[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // CRITICAL：依赖数组故意是空的。innerHTML 只在挂载时写一次——打字期间重写
  // children 等于把光标踢回第一个字。外部换了值时整个组件会被 key 换掉（见
  // CardView 里的 key），所以不会漏更新。
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.setAttribute('contenteditable', 'true')
    el.innerHTML = paragraphsToHtml(paragraphs)
    syncEmpty(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 空态标记给 CSS 用——contenteditable 没有 placeholder。写出去的空内容是
  // <p><br></p>（得有东西撑着，否则光标进不去），所以 :empty 选不中它。
  function syncEmpty(el: HTMLElement) {
    el.toggleAttribute('data-empty', readParagraphs(el).length === 0)
  }

  return (
    <div
      ref={ref}
      className="card-en-p"
      data-style={style}
      data-placeholder={placeholder}
      role="textbox"
      aria-multiline="true"
      aria-label="这张卡的英文"
      spellCheck
      suppressContentEditableWarning
      onInput={(e) => syncEmpty(e.currentTarget)}
      onBlur={(e) => onCommit(readParagraphs(e.currentTarget))}
      // 粘贴只取 text/plain。contenteditable="true" 下浏览器默认会把源格式
      // （字号、颜色、HTML）一起带进来，所以这道闸是必须的。
      // 用 execCommand 插入——它过时但到处都在，而且插入会留在浏览器的原生
      // 撤销栈里，这是 Cmd+Z 在这一栈唯一还能指望的东西。
      onPaste={(e) => {
        e.stopPropagation()
        const text = e.clipboardData?.getData('text/plain')
        if (text == null) return
        e.preventDefault()
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertText', false, text)
          syncEmpty(e.currentTarget)
        }
      }}
      // CRITICAL：拦住事件，别让它们冒到 ProseMirror 的根上去。PM 的 keymap 抓
      // Backspace / Enter 等键，那是原来"英文格子里删不掉行"的另一半原因。
      onKeyDown={(e) => {
        e.stopPropagation()
        // 拦掉富文本命令。contenteditable="true" 给了它们入口，而英文栏存的是
        // 纯文本——让 Cmd+B 插进一个 <b>，它会在失焦时被 readParagraphs 读没，
        // 作者看见"加粗了又没了"，比一开始就按不动更让人迷惑。
        if ((e.metaKey || e.ctrlKey) && 'biu'.includes(e.key.toLowerCase())) e.preventDefault()
      }}
      onKeyUp={(e) => e.stopPropagation()}
      onBeforeInput={(e) => e.stopPropagation()}
      onCut={(e) => e.stopPropagation()}
      onDragStart={(e) => e.stopPropagation()}
    />
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
  function commit(next: string[]) {
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
            否则一律按正文。英文自己不存样式。 */}
        <EnField
          // key 带上当前值：外部改动（切卡/合卡重算了 en）时整个换一个，从而重写
          // innerHTML。打字期间不会触发——我们只在失焦时写回。
          key={`${cardId ?? 'n'}-${enToText(en)}`}
          paragraphs={en ?? []}
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
