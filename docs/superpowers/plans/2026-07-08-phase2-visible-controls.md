# Phase 2 · 看得见的操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让写作工具能**完全用鼠标**建卡、加线（分隔）、换序、合并、加章、改章名——把 Phase 1 藏在快捷键里的引擎，变成看得见摸得着的界面。

**Architecture:** 把 `Card` 从纯 renderHTML 升级为 **React NodeView**（`@tiptap/react` 的 `ReactNodeViewRenderer`），每张卡片渲染成 `<section class="card">` + 正文（`NodeViewContent`）+ 一簇 **hover 才显形的控制按钮**（▲▼ 换序、✕ 合并进上一张、＋ 在此后加一张卡）。按钮通过 `getPos()` 把选区放进本卡再调用已有命令，复用 Phase 1 的 `moveCardUp/moveCardDown/mergeCardBackward`，只新增 `insertCardAfter`/`appendCard` 两个命令。章末一个"＋ 加一张卡"按钮，空卡显灰色占位提示，章标题双击可改名。

**Tech Stack:** 沿用 Phase 1（React 19, TipTap v3 `@tiptap/react`, ProseMirror, Zustand, Vitest）。React NodeView 用 `ReactNodeViewRenderer` + `NodeViewWrapper`/`NodeViewContent`。

## Global Constraints
- 复用现有命令，不改其签名：`splitCard`、`mergeCardBackward`、`moveCardUp`、`moveCardDown`。
- 卡片属性名不变：`cardId`/`threadId`/`role`。新卡片经 `assignCardIds` 补 `cardId`。
- NodeView 里正文必须用 `NodeViewContent`（否则 ProseMirror 无法编辑卡内文字）。
- 控制按钮默认隐藏，卡片 hover 才出现；不干扰阅读排版。
- 不引入 Supabase、颜色 UI（Phase 3）、盒子（Phase 4）、语义样式切换 UI（Phase 5）。role 仍恒 'body'。
- TDD：命令与 store 动作先写失败测试；NodeView 纯视图部分用组件渲染测试 + 浏览器手动验证。

---

### Task 1: 新命令 insertCardAfter / appendCard

**Files:** Modify `src/editor/schema.ts`; Test `src/editor/insertCard.test.ts`

**Interfaces:**
- Produces:
  - `insertCardAfter()` — 在光标所在 card 之后插入一张空卡（含一个空 paragraph），新卡经 assignCardIds 得新 id；光标落进新卡。
  - `appendCard()` — 在文档末尾追加一张空卡，光标落进它。
  - 两者加入 `declare module` 的 `card` Commands 接口。

- [ ] **Step 1: 失败测试** — `src/editor/insertCard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function twoCards() {
  return new Editor({ extensions: baseExtensions, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
    { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
  ] } })
}
const ids = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)
function caretIn(e: Editor, cardId: string) {
  let pos = -1
  e.state.doc.descendants((n, p) => { if (n.type.name === 'card' && n.attrs.cardId === cardId) pos = p + 2 })
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, pos)))
}

describe('insertCardAfter / appendCard', () => {
  it('insertCardAfter 在当前卡后插入一张新空卡', () => {
    const e = twoCards(); caretIn(e, 'c0'); e.commands.insertCardAfter()
    const cs = e.getJSON().content!
    expect(cs.length).toBe(3)
    expect(cs[0].attrs.cardId).toBe('c0')
    expect(cs[1].attrs.cardId).toBeTruthy(); expect(cs[1].attrs.cardId).not.toBe('c0'); expect(cs[1].attrs.cardId).not.toBe('c1')
    expect(cs[2].attrs.cardId).toBe('c1')
    expect(cs[1].content![0].type).toBe('paragraph')
    e.destroy()
  })
  it('appendCard 在末尾追加一张空卡', () => {
    const e = twoCards(); e.commands.appendCard()
    const cs = e.getJSON().content!
    expect(cs.length).toBe(3)
    expect(cs[2].attrs.cardId).toBeTruthy()
    expect(ids(e).slice(0, 2)).toEqual(['c0', 'c1'])
    e.destroy()
  })
})
```

- [ ] **Step 2: 跑 `npm test -- insertCard`，确认 FAIL。**

- [ ] **Step 3: 实现** — 在 `schema.ts` 顶层加 helper：
```ts
import { Fragment } from '@tiptap/pm/model'
function emptyCardNode(schema: any) {
  const paragraph = schema.nodes.paragraph.createAndFill()!
  return schema.nodes.card.create({ cardId: null, threadId: null, role: 'body' }, paragraph)
}
```
在 `Card.addCommands` 里加：
```ts
      insertCardAfter:
        () => ({ state, dispatch }) => {
          const { $from } = state.selection
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'card') { cardDepth = d; break }
          if (cardDepth === -1) return false
          if (dispatch) {
            const after = $from.after(cardDepth)
            const card = emptyCardNode(state.schema)
            const tr = state.tr.insert(after, card)
            tr.setSelection(TextSelection.create(tr.doc, after + 2))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
      appendCard:
        () => ({ state, dispatch }) => {
          if (dispatch) {
            const end = state.doc.content.size
            const card = emptyCardNode(state.schema)
            const tr = state.tr.insert(end, card)
            tr.setSelection(TextSelection.create(tr.doc, end + 2))
            dispatch(tr.scrollIntoView())
          }
          return true
        },
```
`declare module` 的 `card` 接口补：`insertCardAfter: () => ReturnType; appendCard: () => ReturnType`。（`TextSelection` 已从 `@tiptap/pm/state` 引入；`Fragment` 若未用可不引。位置若差一以测试通过为准。）

- [ ] **Step 4: 跑 `npm test -- insertCard`，确认 2 passed；再跑全量 `npm test`。**

- [ ] **Step 5: 提交** `git add -A && git commit -m "feat: insertCardAfter / appendCard commands"`

---

### Task 2: Card React NodeView + hover 控制按钮

**Files:** Create `src/editor/CardView.tsx`; Modify `src/editor/schema.ts`（Card 加 `addNodeView`）, `src/styles.css`; Test `src/editor/CardView.test.tsx`

**Interfaces:**
- Consumes: 命令 `moveCardUp/moveCardDown/mergeCardBackward/insertCardAfter`，`getPos`。
- Produces: 每张卡片渲染为 `section.card`，正文在 `NodeViewContent`，右上角 hover 显一簇按钮：`▲`(上移) `▼`(下移) `＋`(在此后加卡) `✕`(合并进上一张)。第一张卡的 `▲` 与 `✕` 禁用（首卡无上一张）。

- [ ] **Step 1: 失败测试（渲染 + 结构）** — `src/editor/CardView.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import { baseExtensions } from './schema'

function Harness() {
  const editor = useEditor({ extensions: baseExtensions, immediatelyRender: false, content: { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
    { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二' }] }] },
  ] } })
  if (!editor) return null
  return <EditorContent editor={editor} />
}

describe('CardView', () => {
  it('每张卡渲染成带控制按钮的 section.card，正文可见', async () => {
    const { container } = render(<Harness />)
    await new Promise((r) => setTimeout(r, 0))
    const cards = container.querySelectorAll('section.card')
    expect(cards.length).toBe(2)
    expect(container.textContent).toContain('第一')
    expect(container.textContent).toContain('第二')
    // 控制按钮存在（用 data-card-ctrl 标记）
    expect(container.querySelectorAll('[data-card-ctrl="up"]').length).toBe(2)
    expect(container.querySelectorAll('[data-card-ctrl="add"]').length).toBe(2)
  })
})
```

- [ ] **Step 2: 跑 `npm test -- CardView`，确认 FAIL。**

- [ ] **Step 3: 实现 NodeView** — `src/editor/CardView.tsx`:
```tsx
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react'

export function CardView({ editor, getPos }: NodeViewProps) {
  const run = (cmd: 'up' | 'down' | 'add' | 'merge') => (e: React.MouseEvent) => {
    e.preventDefault()
    const pos = getPos()
    if (typeof pos !== 'number') return
    const chain = editor.chain().focus().setTextSelection(pos + 2)
    if (cmd === 'up') chain.moveCardUp().run()
    else if (cmd === 'down') chain.moveCardDown().run()
    else if (cmd === 'add') chain.insertCardAfter().run()
    else chain.mergeCardBackward().run()
  }
  const isFirst = typeof getPos() === 'number' && getPos() === 0
  return (
    <NodeViewWrapper as="section" className="card">
      <div className="card-ctrls" contentEditable={false}>
        <button data-card-ctrl="up" title="上移" disabled={isFirst} onMouseDown={run('up')}>▲</button>
        <button data-card-ctrl="down" title="下移" onMouseDown={run('down')}>▼</button>
        <button data-card-ctrl="add" title="在此后加一张卡" onMouseDown={run('add')}>＋</button>
        <button data-card-ctrl="merge" title="合并进上一张" disabled={isFirst} onMouseDown={run('merge')}>✕</button>
      </div>
      <NodeViewContent className="card-body" />
    </NodeViewWrapper>
  )
}
```
在 `schema.ts`：`import { ReactNodeViewRenderer } from '@tiptap/react'` 和 `import { CardView } from './CardView'`；给 `Card` 加：
```ts
  addNodeView() {
    return ReactNodeViewRenderer(CardView)
  },
```
（`renderHTML`/`parseHTML` 保留，供 getJSON/复制粘贴。）

`styles.css` 加/改：
```css
.river .card { position: relative; padding: 12px 16px 12px 40px; }
.river .card .card-ctrls {
  position: absolute; top: 8px; right: 8px; display: flex; gap: 2px;
  opacity: 0; transition: opacity .12s;
}
.river .card:hover .card-ctrls { opacity: 1; }
.river .card-ctrls button {
  border: 1px solid var(--faint); background: var(--paper); color: var(--muted);
  border-radius: 4px; width: 22px; height: 22px; font-size: 11px; cursor: pointer; line-height: 1;
}
.river .card-ctrls button:hover:not(:disabled) { color: var(--ink); border-color: var(--hair); }
.river .card-ctrls button:disabled { opacity: .3; cursor: default; }
.river .card-body p { margin: 0; line-height: 1.95; font-size: 15px; text-indent: 2em; }
```
（把 Phase 1 里 `.river p` 的排版规则迁到 `.river .card-body p`；保留 `.card + .card::before` 的横线。）

- [ ] **Step 4: 跑 `npm test -- CardView`，确认 passed；全量 `npm test`。**

- [ ] **Step 5: `npm run build` 确认编译过；提交** `git commit -m "feat: Card React NodeView with hover controls"`

---

### Task 3: 章末"＋ 加一张卡" + 空卡占位提示

**Files:** Modify `src/editor/RiverEditor.tsx`, `src/styles.css`; add Placeholder ext to `src/editor/schema.ts`; Test `src/editor/RiverEditor.test.tsx`（扩充）

**Interfaces:**
- Produces: RiverEditor 底部一个 `button.add-card`（文案"＋ 加一张卡"），点它 `editor.chain().focus().appendCard().run()`。空 paragraph 显灰色占位「开始写…」。

- [ ] **Step 1: 失败测试** — 在 `src/editor/RiverEditor.test.tsx` 追加：
```tsx
import userEvent from '@testing-library/user-event'
it('底部“＋ 加一张卡”按钮把新卡加进当前章', async () => {
  const id = useBookStore.getState().activeChapterId
  useBookStore.getState().updateChapterDoc(id, { type: 'doc', content: [
    { type: 'card', attrs: { cardId: 'c0' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
  ] })
  const { getByText } = render(<RiverEditor chapterId={id} />)
  await new Promise((r) => setTimeout(r, 0))
  await userEvent.click(getByText('＋ 加一张卡'))
  await new Promise((r) => setTimeout(r, 0))
  expect(useBookStore.getState().getActiveChapter().doc as any).toBeTruthy()
  const cards = (useBookStore.getState().getActiveChapter().doc as any).content
  expect(cards.length).toBe(2)
})
```

- [ ] **Step 2: 跑 `npm test -- RiverEditor`，确认新用例 FAIL。**

- [ ] **Step 3: 实现** — `RiverEditor.tsx` 在 `EditorContent` 后加：
```tsx
      <button className="add-card" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().appendCard().run() }}>
        ＋ 加一张卡
      </button>
```
把整体包一层 `<div className="river-wrap">…</div>`（EditorContent + 按钮）。
Placeholder：`npm i @tiptap/extension-placeholder`，在 `schema.ts` 的 `baseExtensions` 加 `Placeholder.configure({ placeholder: '开始写…', emptyNodeClass: 'is-empty' })`（放数组末尾）。
`styles.css`:
```css
.river-wrap { width: min(680px, 90%); }
.river-wrap .river { width: 100%; }
.add-card { margin: 14px 0 0 40px; border: 1px dashed var(--faint); background: none; color: var(--muted); border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.add-card:hover { color: var(--ink); border-color: var(--hair); }
.river p.is-empty::before { content: attr(data-placeholder); color: var(--muted); opacity: .5; float: left; height: 0; pointer-events: none; }
```
（`.page` 的居中改成包 `.river-wrap`。若 Placeholder 的空判定 class 名不同，以实际渲染出的占位为准。）

- [ ] **Step 4: 跑 `npm test -- RiverEditor`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: append-card button + empty placeholder"`

---

### Task 4: 章重命名（双击）

**Files:** Modify `src/state/bookStore.ts`（加 `renameChapter`）, `src/ui/ChapterRail.tsx`; Test `src/state/bookStore.test.ts`（扩充）, `src/ui/ChapterRail.test.tsx`

**Interfaces:**
- Produces: store 动作 `renameChapter(id, title)`（持久化）；ChapterRail 双击某章进入行内编辑（`<input>`），回车/失焦保存。

- [ ] **Step 1: 失败测试（store）** — `bookStore.test.ts` 追加：
```ts
it('renameChapter 改名并持久化', () => {
  const s = useBookStore.getState(); const id = s.activeChapterId
  s.renameChapter(id, '离岸')
  expect(useBookStore.getState().book.chapters.find(c => c.id === id)!.title).toBe('离岸')
  const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
  expect(raw.chapters.find((c: any) => c.id === id).title).toBe('离岸')
})
```
失败测试（组件）— `src/ui/ChapterRail.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChapterRail } from './ChapterRail'
import { useBookStore } from '../state/bookStore'
beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })
it('双击章名可改名', async () => {
  render(<ChapterRail />)
  const chap = screen.getByText('第一章')
  await userEvent.dblClick(chap)
  const input = screen.getByDisplayValue('第一章')
  await userEvent.clear(input); await userEvent.type(input, '离岸{Enter}')
  expect(useBookStore.getState().book.chapters[0].title).toBe('离岸')
})
```

- [ ] **Step 2: 跑 `npm test -- bookStore ChapterRail`，确认 FAIL。**

- [ ] **Step 3: 实现** — `bookStore.ts` 加动作：
```ts
    renameChapter: (id, title) => {
      const book = { ...get().book, chapters: get().book.chapters.map((c) => (c.id === id ? { ...c, title } : c)) }
      persist(book); set({ book })
    },
```
并在 `BookState` 类型加 `renameChapter: (id: string, title: string) => void`。
`ChapterRail.tsx`：给每个章项加双击进入编辑态（`useState` 存 editingId + 本地值），`<input>` 回车或 blur 时 `renameChapter(id, value)` 并退出编辑态；非编辑态时点一下仍是 `setActive`。（保持既有 `.chap`/`.add` class；input 用 `.chap-edit` class，宽度撑满、无边框。）
`styles.css` 加：`.chap-edit{ width:100%; border:1px solid var(--hair); border-radius:4px; background:var(--paper); color:var(--ink); font:inherit; padding:4px 6px; }`

- [ ] **Step 4: 跑 `npm test -- bookStore ChapterRail`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: chapter rename via double-click"`

---

## Phase 2 完成后

打开网页：卡片 hover 出 ▲▼＋✕，章末有"＋ 加一张卡"，空卡有灰字提示，双击章名能改。**全程不碰键盘也能建卡、加线、换序、合并、加章、改名。**

## Self-Review
- 覆盖用户痛点"不知道怎么加卡/加线/加块" → Task 2（＋加卡、✕合并）+ Task 3（章末加卡）。换序 → Task 2 ▲▼。改章名 → Task 4。
- 占位符：无 TBD；ProseMirror 位置/Placeholder class 名注明"以渲染/测试为准"，测试有确切断言。
- 类型一致：新命令 `insertCardAfter/appendCard`、store `renameChapter`、NodeView `data-card-ctrl` 标记跨任务一致。
