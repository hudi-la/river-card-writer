// 工具栏图标：每个都是这个段落样式的「样本」——画出它排出来大概的样子，而不是
// 一个需要读的词。所以层级靠「缩进 + 粗细」表示（跟左边目录树的缩进同一套语言），
// 块样式画出它自己的记号（圆点 / 竖线 / 标签）。
//
// 共用画布：16×16，文本行画成 x=2…14 的横线，三行分别落在 y=4 / 8 / 12。
// 一律 currentColor + fill:none，所以按钮的 hover/高亮态换 color 就够，图标跟着走。

type IconProps = { className?: string }

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

// 正文：三行等宽文本，首行缩进——正文段落在编辑器里就是首行缩进 2em。
export function IconBody(_: IconProps) {
  return (
    <Svg>
      <path d="M6 4h8M2 8h12M2 12h9" strokeWidth="1.3" />
    </Svg>
  )
}

// 章 / 节 / 二级：同一个构图——上面一条「标题条」，下面两行淡正文当比例尺，
// 所以三档的粗细差和缩进差是看得出来的（光一条横线是分不清的）。
// 章还多一条通栏分隔线：排版视图里章名下面确实压着一条线。
function Heading({ x, weight, rule }: { x: number; weight: number; rule?: boolean }) {
  return (
    <Svg>
      <path d={`M${x} 4.5h${13 - x}`} strokeWidth={weight} />
      {rule ? <path d="M2 8h12" strokeWidth="1" opacity=".75" /> : null}
      <path d={`M${x} ${rule ? 11.5 : 9.5}h${14 - x}`} strokeWidth="1" opacity=".38" />
      <path d={`M${x} ${rule ? 14 : 12.5}h${(14 - x) * 0.66}`} strokeWidth="1" opacity=".38" />
    </Svg>
  )
}

export function IconChapter(_: IconProps) {
  return <Heading x={2} weight={3} rule />
}

export function IconH1(_: IconProps) {
  return <Heading x={4} weight={2.2} />
}

export function IconH2(_: IconProps) {
  return <Heading x={6} weight={1.5} />
}

// 列表：圆点 + 行，三条。
export function IconBullet(_: IconProps) {
  return (
    <Svg>
      <circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <path d="M6.5 4h7.5M6.5 8h7.5M6.5 12h5.5" strokeWidth="1.3" />
    </Svg>
  )
}

// 引用：左边一条竖线 + 两行——跟它排出来的样子一致。
export function IconQuote(_: IconProps) {
  return (
    <Svg>
      <path d="M3 3.5v9" strokeWidth="2.2" />
      <path d="M7 6h7M7 10h5" strokeWidth="1.3" />
    </Svg>
  )
}

// 注：左上角一个小标签框 + 两行小字，正是它排出来的样子。
export function IconNote(_: IconProps) {
  return (
    <Svg>
      <rect x="2.6" y="3.1" width="4.6" height="4.2" rx="1.2" strokeWidth="1.1" />
      <path d="M9.4 5.2h4.6M2.6 10.6h11.4M2.6 13.4h7.6" strokeWidth="1.2" />
    </Svg>
  )
}
