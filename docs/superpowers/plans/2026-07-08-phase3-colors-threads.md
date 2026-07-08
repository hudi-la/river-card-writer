# Phase 3 · 颜色 = 线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让卡片能归到一条"线"（主题），线有颜色；渲染成**连续的极淡色带**——同一条线的相邻卡片连成一整片、横线穿过不断色，换线才换色，不归线则无色。把设计里"版面服务 A、颜色偷偷承载 B"落地。

**Architecture:** "线"存在 book 层（Zustand store `book.threads: Thread[]`，每条 `{ id, name, color }`，color 是十六进制）。卡片归线 = 设置 card 节点已有的 `threadId` 属性（经 `updateChapterDoc` 随 doc 持久化）。`CardView` 读 store 把 `threadId → color` 映射成一层 `background: color-mix(in srgb, <color> 15%, transparent)`；相邻同色卡片自然连成一片（卡片间无外边距、横线是覆盖其上的 `::before`）。卡片控制簇加一个"●线"入口，弹小菜单：选已有线 / 新建线 / 去色。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。颜色用 CSS `color-mix`。

## Global Constraints
- `Thread = { id: string; name: string; color: string /* hex like '#7fa3c4' */ }`，存 `book.threads`。
- 卡片归线通过 card 节点的 `threadId` 属性（名字不变），null = 不归线 = 无色。
- 固定调色板 `THREAD_PALETTE`（低饱和）；新建线自动取下一个未用色，可后续手动改（本期先自动取色）。
- 连续色带：同 threadId 相邻卡片必须视觉连成一片、横线不断色；不同线相接直接换色；无色卡片透明。
- 迁移：已存在的 localStorage book（无 `threads` 字段）读入时补 `threads: []`，不崩。
- 不引入盒子（Phase 4）、语义样式 UI（Phase 5）、Supabase。
- TDD：store 动作、editor 命令先写失败测试；纯视图/菜单部分组件测试 + 浏览器手动验证。

---

### Task 1: store 里的 threads + 调色板

**Files:** Modify `src/state/bookStore.ts`; Test `src/state/bookStore.test.ts`（扩充）

**Interfaces:**
- Produces:
  - 类型 `Thread = { id: string; name: string; color: string }`；`Book` 增加 `threads: Thread[]`。
  - 导出 `THREAD_PALETTE: string[]`（≥6 个 hex，取自设计的低饱和蓝/红/绿/琥珀/紫/青）。
  - action `addThread(name: string, color?: string): Thread` —— 建一条线（color 缺省时取 `THREAD_PALETTE` 里第一个未被现有线占用的色，用尽则循环），持久化，返回它。
  - action `getThread(id: string | null): Thread | undefined`。
  - `freshBook()` 含 `threads: []`；`load()` 对缺 `threads` 的旧数据补 `[]`。

- [ ] **Step 1: 失败测试** — `bookStore.test.ts` 追加：
```ts
import { THREAD_PALETTE } from './bookStore'
it('初始 book 有空 threads', () => {
  expect(useBookStore.getState().book.threads).toEqual([])
})
it('addThread 建线、取调色板色、持久化、返回它', () => {
  const t = useBookStore.getState().addThread('语言')
  expect(t.name).toBe('语言')
  expect(THREAD_PALETTE).toContain(t.color)
  expect(useBookStore.getState().book.threads).toHaveLength(1)
  const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
  expect(raw.threads[0].name).toBe('语言')
})
it('addThread 连建两条取不同色', () => {
  const a = useBookStore.getState().addThread('a')
  const b = useBookStore.getState().addThread('b')
  expect(a.color).not.toBe(b.color)
})
it('load() 给缺 threads 的旧数据补空数组', () => {
  localStorage.setItem('card-writer:book', JSON.stringify({ id: 'x', title: 't', chapters: [{ id: 'c', title: 'c', doc: { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] } }] }))
  useBookStore.getState().__resetForTest() // 触发从存储重载路径的等价物：见下方实现说明
  // 直接断言 store 暴露的 reloadFromStorage 行为
})
```
> 实现说明：现有 `load()` 只在模块初始化跑一次。为可测"补 threads"，把补齐逻辑做成纯函数 `normalizeBook(raw): Book` 并导出，测试直接断言 `normalizeBook({...无 threads...}).threads === []`。把上面第 4 个测试改成：
```ts
import { normalizeBook } from './bookStore'
it('normalizeBook 给缺 threads 的旧数据补空数组', () => {
  const b = normalizeBook({ id:'x', title:'t', chapters:[{ id:'c', title:'c', doc:{ type:'doc', content:[{type:'card',content:[{type:'paragraph'}]}] } }] })
  expect(b.threads).toEqual([])
})
```

- [ ] **Step 2: 跑 `npm test -- bookStore`，确认 FAIL。**

- [ ] **Step 3: 实现** —— `bookStore.ts`:
```ts
export const THREAD_PALETTE = ['#7fa3c4', '#d98b7a', '#8bad86', '#d8b46a', '#a98cc4', '#6bb0ad']
export type Thread = { id: string; name: string; color: string }
```
`Book` 类型加 `threads: Thread[]`。加导出：
```ts
export function normalizeBook(raw: any): Book {
  return { id: raw.id, title: raw.title, chapters: raw.chapters, threads: Array.isArray(raw.threads) ? raw.threads : [] }
}
```
`freshBook()` 返回对象加 `threads: []`。`load()` 里 `return normalizeBook(JSON.parse(raw))`（仍包在 try/catch + 形状 guard 内）。
store 加：
```ts
    addThread: (name, color) => {
      const used = new Set(get().book.threads.map((t) => t.color))
      const auto = THREAD_PALETTE.find((c) => !used.has(c)) ?? THREAD_PALETTE[get().book.threads.length % THREAD_PALETTE.length]
      const thread: Thread = { id: nanoid(), name, color: color ?? auto }
      const book = { ...get().book, threads: [...get().book.threads, thread] }
      persist(book); set({ book })
      return thread
    },
    getThread: (id) => (id ? get().book.threads.find((t) => t.id === id) : undefined),
```
`BookState` 类型补 `threads`（在 book 里）、`addThread: (name: string, color?: string) => Thread`、`getThread: (id: string | null) => Thread | undefined`。

- [ ] **Step 4: 跑 `npm test -- bookStore`，全量 `npm test`。**

- [ ] **Step 5: 提交** `git commit -m "feat: threads (lines) in book store + palette"`

---

### Task 2: setCardThread 命令

**Files:** Modify `src/editor/schema.ts`; Test `src/editor/setCardThread.test.ts`

**Interfaces:**
- Produces: 命令 `setCardThread(threadId: string | null)` —— 把光标所在 card 的 `threadId` 属性设为给定值（null = 去色）。加入 `declare module` 的 `card` 接口。

- [ ] **Step 1: 失败测试** — `src/editor/setCardThread.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function oneCard() {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
  ] } })
}
describe('setCardThread', () => {
  it('把当前卡的 threadId 设为给定值，再置空', () => {
    const e = oneCard()
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)))
    e.commands.setCardThread('t1')
    expect(e.getJSON().content![0].attrs.threadId).toBe('t1')
    e.commands.setCardThread(null)
    expect(e.getJSON().content![0].attrs.threadId).toBe(null)
    e.destroy()
  })
})
```

- [ ] **Step 2: 跑 `npm test -- setCardThread`，确认 FAIL。**

- [ ] **Step 3: 实现** — `Card.addCommands` 加：
```ts
      setCardThread:
        (threadId: string | null) =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'card') { cardDepth = d; break }
          if (cardDepth === -1) return false
          if (dispatch) dispatch(state.tr.setNodeAttribute($from.before(cardDepth), 'threadId', threadId))
          return true
        },
```
`declare module` 补 `setCardThread: (threadId: string | null) => ReturnType`。

- [ ] **Step 4: 跑 `npm test -- setCardThread`，全量 `npm test`。**

- [ ] **Step 5: 提交** `git commit -m "feat: setCardThread command"`

---

### Task 3: 连续色带渲染

**Files:** Modify `src/editor/CardView.tsx`, `src/styles.css`; Test `src/editor/CardView.test.tsx`（扩充）

**Interfaces:**
- Consumes: `useBookStore().getThread`，card node 的 `threadId` 属性（`props.node.attrs.threadId`）。
- Produces: 有 threadId 的卡片渲染出一层 `background: color-mix(in srgb, <threadColor> 15%, transparent)`（用内联 style 设 CSS 变量 `--thread`），并加 `data-thread-id` 属性。相邻同 threadId 卡片视觉连成一片。

- [ ] **Step 1: 失败测试** — `CardView.test.tsx` 追加一个用例：先 `useBookStore.getState().addThread(...)` 拿到 thread（或直接注入 threads），构造两张 `threadId` 相同的卡，断言两张 `section.card` 都带 `data-thread-id` 且相等、且内联 style 含 `--thread`。（渲染后读 `container.querySelectorAll('section.card[data-thread-id]')`。）

- [ ] **Step 2: 跑 `npm test -- CardView`，确认新用例 FAIL。**

- [ ] **Step 3: 实现** — `CardView.tsx`：
```tsx
import { useBookStore } from '../state/bookStore'
// 在组件内：
const threadId: string | null = props.node.attrs.threadId
const thread = useBookStore((s) => s.getThread(threadId))
const style = thread ? ({ ['--thread' as any]: thread.color } as React.CSSProperties) : undefined
// NodeViewWrapper 加 style + data：
<NodeViewWrapper as="section" className="card" data-thread-id={threadId || undefined} style={style}>
```
`styles.css`：
```css
.river .card[data-thread-id] { background: color-mix(in srgb, var(--thread) 15%, transparent); }
.river .card { padding: 12px 16px 12px 40px; }   /* 无外边距，色带相邻即连片 */
/* 横线覆盖在色带之上、内缩，不打断颜色 */
.river .card + .card::before { content:""; position:absolute; left:40px; right:16px; top:0; border-top:1px solid var(--hair); }
```
（确保 `.card` 已 `position: relative`。色带淡到不碍读。）

- [ ] **Step 4: 跑 `npm test -- CardView`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: continuous color bands from thread color"`

---

### Task 4: 卡片上的"●线"选择菜单

**Files:** Modify `src/editor/CardView.tsx`, `src/styles.css`; Test `src/editor/CardThreadMenu.test.tsx`

**Interfaces:**
- Consumes: `useBookStore`（threads、addThread）、命令 `setCardThread`、`getPos`。
- Produces: 卡片控制簇加一个 `data-card-ctrl="thread"` 的"●"按钮，点开一个小菜单：① 列出现有线（彩点 + 名字，点=把本卡设成该线）；② "＋ 新建线"（用一个内联输入取名 → `addThread(name)` → 立即把本卡设成新线）；③ "去色"（`setCardThread(null)`）。所有"设本卡"动作走 `getPos()+setTextSelection(pos+2)` 再调 `setCardThread`。

- [ ] **Step 1: 失败测试** — `src/editor/CardThreadMenu.test.tsx`：渲染带一张卡的编辑器（同 CardView 测试的 Harness），点 `[data-card-ctrl="thread"]` 打开菜单，点"＋ 新建线"输入"语言"回车，断言：store.threads 多了一条名"语言"，且该卡 JSON 的 `threadId` 等于新线 id。（可复用 Task 2/3 的 harness 模式。）

- [ ] **Step 2: 跑 `npm test -- CardThreadMenu`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 在 `CardView.tsx` 里加一个受控的小菜单（`useState` open）：
  - 按钮 `<button data-card-ctrl="thread" onMouseDown={...toggle}>●</button>`，● 的颜色 = 当前线色或灰。
  - 菜单项：threads.map → `<button>` 带彩点 + 名字，onMouseDown = `assign(t.id)`；"去色" = `assign(null)`；"＋ 新建线" → 显示一个 `<input>`，回车时 `const t = addThread(value); assign(t.id)`。
  - `assign(threadId)` = `editor.chain().focus().setTextSelection(getPos()+2).setCardThread(threadId).run()` 然后关菜单。
  - 菜单 `contentEditable={false}`，绝对定位在按钮下方。
  `styles.css` 加 `.thread-menu`（小卡片浮层）、`.thread-dot`（8px 圆点，`background: var(--dot)`）等样式。

- [ ] **Step 4: 跑 `npm test -- CardThreadMenu`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 浏览器手动验证** —— `npm run dev`，用 Playwright MCP：给两张相邻卡片选同一条线 → 看到连成一片的淡色带、横线穿过不断色；第三张选另一条线 → 换色；去色 → 变透明。截图。**提交** `git commit -m "feat: per-card thread picker menu"`

---

## Phase 3 完成后
卡片可归线、染色；同线相邻卡连成一整片淡色带，横线穿过不断色；换线换色、去色透明。**你脑子里那张 B 网，第一次作为暗流显影在版面下。**

## Self-Review
- 覆盖 spec 第 5 节（颜色=线、连续色带、可无色）：Task 1（线数据）+ Task 2（归线命令）+ Task 3（连续色带渲染）+ Task 4（选线 UI）。
- 占位符：无 TBD；color-mix / CSS 变量注明以渲染为准，测试断言 data-thread-id + store 状态。
- 类型一致：`Thread`、`THREAD_PALETTE`、`addThread`/`getThread`、`setCardThread`、`data-card-ctrl="thread"`、`data-thread-id` 跨任务一致。
