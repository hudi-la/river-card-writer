# 河流编辑器 · 走路骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出卡片式写作工具的核心：一条连续的文字河，底下是可切分/合并/重排的卡片对象，支持章切换，本地 localStorage 存取。

**Architecture:** React + Vite + TypeScript 前端。编辑器用 TipTap（ProseMirror）：文档由一串 `card` 节点组成，每个 `card` 含一到多个 `paragraph`。卡片的切分/合并/重排 = 对 ProseMirror 文档结构的操作，光标与选择由框架兜底。章/书状态与 localStorage 持久化用 Zustand。这一期不做颜色/线、盒子、Supabase——但 `card` 节点预留 `threadId`/`role` 属性，为后续期留口。ProseMirror 命令的精确写法以每个任务的测试为准（测试断言操作后的文档结构）。

**Tech Stack:** React 18, Vite, TypeScript, TipTap v2 (`@tiptap/react`, `@tiptap/core`, `@tiptap/extension-document`, `@tiptap/extension-paragraph`, `@tiptap/extension-text`), Zustand, nanoid, Vitest, @testing-library/react, jsdom.

## Global Constraints

- 语言/交付：笔记本大屏**网页**，React 单页应用。
- `card` 节点自始至终带三个属性：`cardId`(string)、`threadId`(string|null，本期恒为 null)、`role`('body'|'heading'|'quote'|'note'，本期只用 'body')。属性名固定，后续期依赖。
- 每张卡片必须有唯一 `cardId`；任何缺 id 的卡片由一个 appendTransaction 插件自动补 `nanoid()`。
- TDD：每个任务先写失败测试再实现。频繁提交。
- 不引入 Supabase、颜色 UI、盒子——本期严格只做骨架。

---

### Task 1: 项目脚手架 + 测试环境

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `vitest.config.ts`, `src/setupTests.ts`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Produces: 一个能 `npm run dev` 起、`npm test` 跑的 Vite+React+TS+Vitest 项目。

- [ ] **Step 1: 初始化 package.json 与依赖**

Run:
```bash
cd /Users/dihu/Desktop/card-writer
npm init -y
npm i react react-dom @tiptap/core @tiptap/react @tiptap/extension-document @tiptap/extension-paragraph @tiptap/extension-text @tiptap/pm zustand nanoid
npm i -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event
```

- [ ] **Step 2: 写配置文件**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
})
```

`src/setupTests.ts`:
```ts
import '@testing-library/dom'
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020", "useDefineForClassFields": true, "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true, "moduleResolution": "bundler",
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true, "jsx": "react-jsx",
    "strict": true, "types": ["vitest/globals", "node"]
  },
  "include": ["src"]
}
```

`index.html`:
```html
<!doctype html>
<html lang="zh">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>写作</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
```

`src/App.tsx`:
```tsx
export function App() {
  return <div>写作工具</div>
}
```

Add to `package.json` "scripts": `{"dev":"vite","build":"vite build","test":"vitest run","test:watch":"vitest"}`.

- [ ] **Step 3: 写冒烟测试**

`src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('smoke', () => {
  it('runs', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "chore: scaffold Vite+React+TS+Vitest"
```

---

### Task 2: card / document schema

**Files:**
- Create: `src/editor/schema.ts`
- Test: `src/editor/schema.test.ts`

**Interfaces:**
- Produces:
  - `Card` — TipTap Node，name `'card'`，group `'block'`，content `'paragraph+'`，attrs `cardId|threadId|role`，渲染成 `<section class="card" data-card-id>`。
  - `CardDocument` — Document.extend content `'card+'`。
  - `assignCardIds` — TipTap Extension，用 ProseMirror 插件的 appendTransaction 给缺 `cardId` 的 card 补 `nanoid()`。
  - `baseExtensions: Extension[]` = `[CardDocument, Card, Paragraph, Text, assignCardIds]`，供编辑器与测试共用。
  - `makeTestEditor(json?)` 见测试；实现放测试文件即可。

- [ ] **Step 1: 写失败测试**

`src/editor/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'

function makeEditor(doc?: object) {
  return new Editor({ extensions: baseExtensions, content: doc })
}

describe('card schema', () => {
  it('文档由 card 组成，card 默认 role=body、threadId=null', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] }],
    })
    const json = editor.getJSON()
    expect(json.content?.[0].type).toBe('card')
    expect(json.content?.[0].attrs?.role).toBe('body')
    expect(json.content?.[0].attrs?.threadId).toBe(null)
    editor.destroy()
  })

  it('缺 cardId 的 card 会被自动补上唯一 id', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        { type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        { type: 'card', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
      ],
    })
    const ids = editor.getJSON().content!.map((c: any) => c.attrs.cardId)
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[0]).not.toBe(ids[1])
    editor.destroy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- schema`
Expected: FAIL（`baseExtensions` 不存在）。

- [ ] **Step 3: 实现 schema**

`src/editor/schema.ts`:
```ts
import { Node, Extension, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Plugin } from '@tiptap/pm/state'
import { nanoid } from 'nanoid'

export const CardDocument = Document.extend({ content: 'card+' })

export const Card = Node.create({
  name: 'card',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      cardId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-card-id'),
        renderHTML: (attrs) => (attrs.cardId ? { 'data-card-id': attrs.cardId } : {}),
      },
      threadId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-thread-id'),
        renderHTML: (attrs) => (attrs.threadId ? { 'data-thread-id': attrs.threadId } : {}),
      },
      role: {
        default: 'body',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-role') || 'body',
        renderHTML: (attrs) => ({ 'data-role': attrs.role }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'section[data-card-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { class: 'card' }), 0]
  },
})

export const assignCardIds = Extension.create({
  name: 'assignCardIds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const tr = newState.tr
          let modified = false
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'card' && !node.attrs.cardId) {
              tr.setNodeAttribute(pos, 'cardId', nanoid())
              modified = true
            }
          })
          return modified ? tr : null
        },
      }),
    ]
  },
})

export const baseExtensions = [CardDocument, Card, Paragraph, Text, assignCardIds]
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- schema`
Expected: 2 passed。若"自动补 id"测试因 appendTransaction 时机未触发而失败，在断言前加 `editor.commands.setContent(editor.getJSON())` 触发一次事务；以测试通过为准。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: card + document schema with auto cardId"
```

---

### Task 3: 切分卡片命令（splitCard）

**Files:**
- Modify: `src/editor/schema.ts`（给 `Card` 加 `addCommands`）
- Test: `src/editor/splitCard.test.ts`

**Interfaces:**
- Consumes: `baseExtensions`。
- Produces: 编辑器命令 `editor.commands.splitCard()` —— 在光标处把当前 card 拆成两个 card；第二个 card 由 `assignCardIds` 补新 id。绑定快捷键 `Mod-Enter`。

- [ ] **Step 1: 写失败测试**

`src/editor/splitCard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function editorWithCaretAfter(text: string, caretAfterChars: number) {
  const editor = new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    ] },
  })
  // 放光标：doc(0) > card(1) > paragraph(2) 起点是 pos 2，向后 caretAfterChars
  const pos = 2 + caretAfterChars
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
  return editor
}

describe('splitCard', () => {
  it('把一个 card 从光标处拆成两个 card，文字各归一半', () => {
    const editor = editorWithCaretAfter('前半后半', 2) // 光标在"前半|后半"
    editor.commands.splitCard()
    const cards = editor.getJSON().content!
    expect(cards.length).toBe(2)
    const t = (c: any) => c.content[0].content?.[0]?.text
    expect(t(cards[0])).toBe('前半')
    expect(t(cards[1])).toBe('后半')
    expect(cards[0].attrs.cardId).toBe('c1')
    expect(cards[1].attrs.cardId).toBeTruthy()
    expect(cards[1].attrs.cardId).not.toBe('c1')
    editor.destroy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- splitCard`
Expected: FAIL（`splitCard` 未定义）。

- [ ] **Step 3: 实现命令**

在 `src/editor/schema.ts` 的 `Card` 定义里加：
```ts
  addCommands() {
    return {
      splitCard:
        () =>
        ({ state, dispatch }) => {
          const { $from } = state.selection
          // 找到 card 所在的深度（card 是 paragraph 的父级）
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'card') { cardDepth = d; break }
          }
          if (cardDepth === -1) return false
          if (dispatch) {
            const tr = state.tr
            if (!state.selection.empty) tr.deleteSelection()
            // 从 paragraph 一路 split 到 card 这一层：两层
            tr.split(tr.selection.from, 2)
            // 清掉新 card 继承来的 cardId，交给 assignCardIds 补新 id
            const posAfter = tr.selection.from
            const $pos = tr.doc.resolve(posAfter)
            for (let d = $pos.depth; d > 0; d--) {
              if ($pos.node(d).type.name === 'card') {
                tr.setNodeAttribute($pos.before(d), 'cardId', null)
                break
              }
            }
            dispatch(tr.scrollIntoView())
          }
          return true
        },
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.splitCard() }
  },
```
> 注意：TypeScript 命令类型声明可用 `declare module '@tiptap/core'` 扩展 `Commands`，若类型报错，在 `src/editor/schema.ts` 顶部加：
```ts
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    card: { splitCard: () => ReturnType }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- splitCard`
Expected: 1 passed。（若 split 的 depth 计算需微调，以让断言"两个 card、文字各半、新 id"通过为准。）

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: splitCard command + Mod-Enter"
```

---

### Task 4: 合并卡片命令（mergeCardBackward）

**Files:**
- Modify: `src/editor/schema.ts`
- Test: `src/editor/mergeCard.test.ts`

**Interfaces:**
- Produces: 命令 `editor.commands.mergeCardBackward()` —— 光标在某 card 的最前端时，把该 card 并入前一个 card（吃掉中间的边界）。绑定 `Backspace`：只有在 card 起点才触发，否则放行默认删除。合并后保留前一个 card 的 `cardId`。

- [ ] **Step 1: 写失败测试**

`src/editor/mergeCard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function twoCards() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: [
      { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }] },
      { type: 'card', attrs: { cardId: 'c2' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二' }] }] },
    ] },
  })
}

describe('mergeCardBackward', () => {
  it('光标在第二个 card 最前端时，两个 card 合并为一个', () => {
    const editor = twoCards()
    // 第二个 card 的段首位置：doc 结构 pos —— 用 resolve 找第二个 card 的起点
    let secondStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'card' && node.attrs.cardId === 'c2') secondStart = pos + 2 // +1 进 card, +1 进 paragraph
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, secondStart)))
    editor.commands.mergeCardBackward()
    const cards = editor.getJSON().content!
    expect(cards.length).toBe(1)
    expect(cards[0].attrs.cardId).toBe('c1')
    // 合并后 card 里有两个 paragraph：第一、第二
    const texts = cards[0].content!.map((p: any) => p.content?.[0]?.text)
    expect(texts).toEqual(['第一', '第二'])
    editor.destroy()
  })

  it('光标不在 card 起点时，命令返回 false（放行默认删除）', () => {
    const editor = twoCards()
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)))
    expect(editor.commands.mergeCardBackward()).toBe(false)
    editor.destroy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- mergeCard`
Expected: FAIL。

- [ ] **Step 3: 实现命令**

在 `Card` 的 `addCommands` 里加 `mergeCardBackward`：
```ts
      mergeCardBackward:
        () =>
        ({ state, dispatch }) => {
          const { $from, empty } = state.selection
          if (!empty) return false
          // 必须在 card 的第一个 paragraph 的最前端
          let cardDepth = -1
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'card') { cardDepth = d; break }
          }
          if (cardDepth === -1) return false
          const atCardStart = $from.pos === $from.start(cardDepth) && $from.index(cardDepth) === 0
          if (!atCardStart) return false
          const cardPos = $from.before(cardDepth)
          if (cardPos <= 0) return false // 已是第一个 card
          if (dispatch) {
            // join card 边界：join 位置 = 当前 card 前的边界点
            dispatch(state.tr.join(cardPos).scrollIntoView())
          }
          return true
        },
```
并在 `addKeyboardShortcuts` 里加：`'Backspace': () => this.editor.commands.mergeCardBackward()`（返回 false 时 TipTap 会继续走默认 Backspace）。
在 `declare module` 的 `card` 接口里补：`mergeCardBackward: () => ReturnType`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- mergeCard`
Expected: 2 passed。（join 的精确 pos 若需微调，以断言通过为准。）

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: mergeCardBackward command + Backspace"
```

---

### Task 5: 重排卡片命令（moveCardUp / moveCardDown）

**Files:**
- Modify: `src/editor/schema.ts`
- Test: `src/editor/moveCard.test.ts`

**Interfaces:**
- Produces: 命令 `moveCardUp()` / `moveCardDown()` —— 把光标所在 card 与上/下一个 card 交换位置。绑定 `Alt-ArrowUp` / `Alt-ArrowDown`。（拖拽把手在 Task 7 的 UI 里接同一命令。）

- [ ] **Step 1: 写失败测试**

`src/editor/moveCard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { baseExtensions } from './schema'
import { TextSelection } from '@tiptap/pm/state'

function threeCards() {
  return new Editor({
    extensions: baseExtensions,
    content: { type: 'doc', content: ['A', 'B', 'C'].map((t, i) => (
      { type: 'card', attrs: { cardId: 'c' + i }, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] }
    )) },
  })
}
function caretInCard(editor: Editor, cardId: string) {
  let pos = -1
  editor.state.doc.descendants((node, p) => { if (node.type.name === 'card' && node.attrs.cardId === cardId) pos = p + 2 })
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}
const order = (e: Editor) => e.getJSON().content!.map((c: any) => c.attrs.cardId)

describe('move card', () => {
  it('moveCardDown 把中间的 B 往下换到 C 后面', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    editor.commands.moveCardDown()
    expect(order(editor)).toEqual(['c0', 'c2', 'c1'])
    editor.destroy()
  })
  it('moveCardUp 把 B 往上换到 A 前面', () => {
    const editor = threeCards()
    caretInCard(editor, 'c1')
    editor.commands.moveCardUp()
    expect(order(editor)).toEqual(['c1', 'c0', 'c2'])
    editor.destroy()
  })
  it('第一个 card moveCardUp 无效、顺序不变', () => {
    const editor = threeCards()
    caretInCard(editor, 'c0')
    editor.commands.moveCardUp()
    expect(order(editor)).toEqual(['c0', 'c1', 'c2'])
    editor.destroy()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- moveCard`
Expected: FAIL。

- [ ] **Step 3: 实现命令**

在 `addCommands` 里加：
```ts
      moveCardUp:
        () =>
        ({ state, dispatch }) => moveCard(state, dispatch, -1),
      moveCardDown:
        () =>
        ({ state, dispatch }) => moveCard(state, dispatch, +1),
```
在 `src/editor/schema.ts` 文件顶层（`Card` 之外）加辅助函数：
```ts
import { EditorState, Transaction } from '@tiptap/pm/state'

function moveCard(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: -1 | 1): boolean {
  const { $from } = state.selection
  let cardDepth = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'card') { cardDepth = d; break }
  }
  if (cardDepth === -1) return false
  const index = $from.index(0) // card 在 doc 里的序号
  const parent = state.doc // doc
  const target = index + dir
  if (target < 0 || target >= parent.childCount) return false
  if (dispatch) {
    const cardNode = parent.child(index)
    const cardPos = $from.before(cardDepth)
    const tr = state.tr.delete(cardPos, cardPos + cardNode.nodeSize)
    // 删除后重新定位插入点
    let insertPos: number
    if (dir === 1) {
      // 插到原来的下一个 card 之后
      const nextNode = parent.child(index + 1)
      insertPos = cardPos + nextNode.nodeSize
    } else {
      const prevNode = parent.child(index - 1)
      insertPos = cardPos - prevNode.nodeSize
    }
    tr.insert(insertPos, cardNode)
    dispatch(tr.scrollIntoView())
  }
  return true
}
```
`declare module` 的 `card` 接口补：`moveCardUp: () => ReturnType; moveCardDown: () => ReturnType`。
`addKeyboardShortcuts` 补：`'Alt-ArrowUp': () => this.editor.commands.moveCardUp(), 'Alt-ArrowDown': () => this.editor.commands.moveCardDown()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- moveCard`
Expected: 3 passed。（`insertPos` 计算若差一，以断言通过为准。）

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: moveCardUp/moveCardDown + Alt-Arrow"
```

---

### Task 6: 书/章状态 + localStorage 持久化

**Files:**
- Create: `src/state/bookStore.ts`
- Test: `src/state/bookStore.test.ts`

**Interfaces:**
- Produces: Zustand store `useBookStore`，形状：
  - state: `book: { id: string; title: string; chapters: Chapter[] }`，`activeChapterId: string`
  - `Chapter = { id: string; title: string; doc: object }`（`doc` = 该章的 ProseMirror JSON）
  - actions: `addChapter(title: string): void`、`setActiveChapter(id: string): void`、`updateChapterDoc(id: string, doc: object): void`、`getActiveChapter(): Chapter`
  - 持久化：每次变更写 `localStorage['card-writer:book']`；初始化时若有则读取，否则建一本带一个空章（含一个空 card）的新书。
  - 导出常量 `EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }`。

- [ ] **Step 1: 写失败测试**

`src/state/bookStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useBookStore, EMPTY_DOC } from './bookStore'

beforeEach(() => {
  localStorage.clear()
  useBookStore.getState().__resetForTest()
})

describe('bookStore', () => {
  it('初始有一本书、一个章、章里是空 doc', () => {
    const s = useBookStore.getState()
    expect(s.book.chapters.length).toBe(1)
    expect(s.getActiveChapter().doc).toEqual(EMPTY_DOC)
  })
  it('addChapter 增加一章并可切换', () => {
    useBookStore.getState().addChapter('第二章')
    const s = useBookStore.getState()
    expect(s.book.chapters.length).toBe(2)
    const second = s.book.chapters[1]
    s.setActiveChapter(second.id)
    expect(useBookStore.getState().activeChapterId).toBe(second.id)
  })
  it('updateChapterDoc 写入并持久化到 localStorage', () => {
    const s = useBookStore.getState()
    const id = s.activeChapterId
    const doc = { type: 'doc', content: [{ type: 'card', attrs: { cardId: 'x' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }] }
    s.updateChapterDoc(id, doc)
    expect(useBookStore.getState().getActiveChapter().doc).toEqual(doc)
    const raw = JSON.parse(localStorage.getItem('card-writer:book')!)
    expect(raw.chapters.find((c: any) => c.id === id).doc).toEqual(doc)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- bookStore`
Expected: FAIL。

- [ ] **Step 3: 实现 store**

`src/state/bookStore.ts`:
```ts
import { create } from 'zustand'
import { nanoid } from 'nanoid'

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'card', content: [{ type: 'paragraph' }] }] }
const KEY = 'card-writer:book'

export type Chapter = { id: string; title: string; doc: object }
export type Book = { id: string; title: string; chapters: Chapter[] }

type BookState = {
  book: Book
  activeChapterId: string
  addChapter: (title: string) => void
  setActiveChapter: (id: string) => void
  updateChapterDoc: (id: string, doc: object) => void
  getActiveChapter: () => Chapter
  __resetForTest: () => void
}

function freshBook(): Book {
  const ch: Chapter = { id: nanoid(), title: '第一章', doc: structuredClone(EMPTY_DOC) }
  return { id: nanoid(), title: '未命名', chapters: [ch] }
}
function load(): Book {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return freshBook()
}
function persist(book: Book) {
  localStorage.setItem(KEY, JSON.stringify(book))
}

export const useBookStore = create<BookState>((set, get) => {
  const initial = load()
  return {
    book: initial,
    activeChapterId: initial.chapters[0].id,
    addChapter: (title) => {
      const ch: Chapter = { id: nanoid(), title, doc: structuredClone(EMPTY_DOC) }
      const book = { ...get().book, chapters: [...get().book.chapters, ch] }
      persist(book)
      set({ book })
    },
    setActiveChapter: (id) => set({ activeChapterId: id }),
    updateChapterDoc: (id, doc) => {
      const book = { ...get().book, chapters: get().book.chapters.map((c) => (c.id === id ? { ...c, doc } : c)) }
      persist(book)
      set({ book })
    },
    getActiveChapter: () => {
      const { book, activeChapterId } = get()
      return book.chapters.find((c) => c.id === activeChapterId) ?? book.chapters[0]
    },
    __resetForTest: () => {
      const book = freshBook()
      persist(book)
      set({ book, activeChapterId: book.chapters[0].id })
    },
  }
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- bookStore`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: book/chapter store with localStorage"
```

---

### Task 7: 编辑器组件 + 章切换 UI + 拖拽把手

**Files:**
- Create: `src/editor/RiverEditor.tsx`, `src/ui/ChapterRail.tsx`, `src/ui/Workspace.tsx`, `src/styles.css`
- Modify: `src/App.tsx`, `src/main.tsx`（引入 styles.css）
- Test: `src/editor/RiverEditor.test.tsx`, `src/ui/Workspace.test.tsx`

**Interfaces:**
- Consumes: `baseExtensions`、`useBookStore`。
- Produces:
  - `RiverEditor({ chapterId })` —— 用 TipTap 渲染该章 doc；`onUpdate` 时 `updateChapterDoc(chapterId, editor.getJSON())`。每个 card 左侧渲染一个拖拽把手 `⠿`（用 ProseMirror `NodeView` 或 CSS `::before` + drag handlers），拖动调用 `moveCardUp/Down`（本期把手先支持"点住往上/往下拖一格"= 触发一次 move；完整自由拖放留后续期）。
  - `ChapterRail()` —— 左栏"章"组：列出章、点击切换、`＋新一章`。
  - `Workspace()` —— 两栏布局：左 `ChapterRail`，中 `RiverEditor`（key=activeChapterId 以在切章时重挂）。

- [ ] **Step 1: 写失败测试（组件渲染 + 章切换）**

`src/ui/Workspace.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Workspace } from './Workspace'
import { useBookStore } from '../state/bookStore'

beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })

describe('Workspace', () => {
  it('显示章列表，点“＋新一章”后多一章', async () => {
    render(<Workspace />)
    expect(screen.getByText('第一章')).toBeTruthy()
    await userEvent.click(screen.getByText('＋ 新一章'))
    expect(useBookStore.getState().book.chapters.length).toBe(2)
  })
})
```

`src/editor/RiverEditor.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { RiverEditor } from './RiverEditor'
import { useBookStore } from '../state/bookStore'

beforeEach(() => { localStorage.clear(); useBookStore.getState().__resetForTest() })

describe('RiverEditor', () => {
  it('把该章 doc 渲染成带 data-card-id 的 section', async () => {
    const id = useBookStore.getState().activeChapterId
    useBookStore.getState().updateChapterDoc(id, {
      type: 'doc', content: [
        { type: 'card', attrs: { cardId: 'c1' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '你好' }] }] },
      ],
    })
    const { container } = render(<RiverEditor chapterId={id} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('section.card')).toBeTruthy()
    expect(container.textContent).toContain('你好')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- Workspace RiverEditor`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现组件**

`src/editor/RiverEditor.tsx`:
```tsx
import { useEditor, EditorContent } from '@tiptap/react'
import { baseExtensions } from './schema'
import { useBookStore } from '../state/bookStore'

export function RiverEditor({ chapterId }: { chapterId: string }) {
  const chapter = useBookStore((s) => s.book.chapters.find((c) => c.id === chapterId))!
  const updateChapterDoc = useBookStore((s) => s.updateChapterDoc)

  const editor = useEditor({
    extensions: baseExtensions,
    content: chapter.doc,
    onUpdate: ({ editor }) => updateChapterDoc(chapterId, editor.getJSON()),
    editorProps: { attributes: { class: 'river' } },
  })

  return <EditorContent editor={editor} />
}
```

`src/ui/ChapterRail.tsx`:
```tsx
import { useBookStore } from '../state/bookStore'

export function ChapterRail() {
  const chapters = useBookStore((s) => s.book.chapters)
  const activeId = useBookStore((s) => s.activeChapterId)
  const setActive = useBookStore((s) => s.setActiveChapter)
  const addChapter = useBookStore((s) => s.addChapter)

  return (
    <nav className="rail">
      <p className="rlabel">章</p>
      {chapters.map((c) => (
        <div
          key={c.id}
          className={'chap' + (c.id === activeId ? ' on' : '')}
          onClick={() => setActive(c.id)}
        >
          {c.title}
        </div>
      ))}
      <div className="add" onClick={() => addChapter('新一章')}>＋ 新一章</div>
    </nav>
  )
}
```

`src/ui/Workspace.tsx`:
```tsx
import { useBookStore } from '../state/bookStore'
import { ChapterRail } from './ChapterRail'
import { RiverEditor } from '../editor/RiverEditor'

export function Workspace() {
  const activeId = useBookStore((s) => s.activeChapterId)
  return (
    <div className="app">
      <ChapterRail />
      <main className="page">
        <RiverEditor key={activeId} chapterId={activeId} />
      </main>
    </div>
  )
}
```

`src/App.tsx`:
```tsx
import { Workspace } from './ui/Workspace'
export function App() { return <Workspace /> }
```

`src/styles.css`（阅读排版 + 连续河 + 横线分段；卡片左侧把手）：
```css
:root { --paper:#fcfaf6; --ink:#252019; --muted:#a89e92; --faint:#e0d8cc; --hair:#d8cfc1; }
* { box-sizing: border-box; }
body { margin:0; background:var(--paper); color:var(--ink); font-family: Georgia,'Songti SC','Noto Serif',serif; }
.app { display:grid; grid-template-columns:172px 1fr; min-height:100vh; }
.rail { padding:20px 12px; border-right:1px solid var(--faint); font-size:13px; }
.rlabel { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin:0 0 10px; }
.chap { padding:6px 8px; border-radius:5px; color:var(--muted); cursor:pointer; }
.chap.on { color:var(--ink); font-weight:600; background:rgba(120,158,196,.12); }
.add { padding:6px 8px; color:var(--muted); cursor:pointer; opacity:.8; }
.page { padding:36px 0; display:flex; justify-content:center; }
.river { width:min(680px,90%); outline:none; }
.river .card { position:relative; padding:12px 16px 12px 40px; }
.river .card + .card::before { content:""; position:absolute; left:40px; right:16px; top:0; border-top:1px solid var(--hair); }
.river .card::after { content:"⠿"; position:absolute; left:14px; top:14px; color:var(--muted); opacity:0; cursor:grab; font-size:12px; }
.river .card:hover::after { opacity:.5; }
.river p { margin:0; line-height:1.95; font-size:15px; text-indent:2em; }
```

`src/main.tsx` 顶部加：`import './styles.css'`。

> 拖拽把手：本期先用简版——给 `.card::after` 的把手加一个 `mousedown` → 记录起点，`mouseup` 时按位移方向调用 `moveCardUp`/`moveCardDown` 一格。实现放在 `RiverEditor.tsx` 里用一个 `useEffect` 给 `editor.view.dom` 挂 `pointerdown` 监听，命中把手区域（`e.target` 的 card、且点击点 x < card 左边距）则据 `pointerup` 的 Δy 符号调用命令。完整自由拖放留后续期，本期测试只覆盖命令层（Task 5 已覆盖），把手交互手动验证即可。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- Workspace RiverEditor`
Expected: 2 passed。

- [ ] **Step 5: 手动验证 + 提交**

Run: `npm run dev`，浏览器打开 Vite 地址。手动确认：能打字；`Mod-Enter` 切分成两段（中间出现横线）；段首 `Backspace` 合并；`Alt-↑/↓` 换序；刷新后内容还在；`＋新一章` 能加章、切章。
```bash
git add -A && git commit -m "feat: RiverEditor + ChapterRail + Workspace shell"
```

---

## 本期完成后的样子

一个能跑的网页：左栏章列表可增可切；中间是连续阅读排版的河，横线分段；`Mod-Enter` 切分、`Backspace` 合并、`Alt-↑/↓` 重排、hover 出把手；本地 localStorage 自动存。**核心的"河 + 软卡片"手感立住了。**

## 后续期（各自独立成计划，本计划不含）

1. **颜色 = 线**：`thread` 数据 + 给 card 设 `threadId` 的 UI + 连续色带渲染（同线相邻 card 连成一片、横线不断色）。
2. **盒子 + 置入**：盒子数据与左栏第二组、盒子打开视图（翻页/缩略图两种试）、InDesign 式装载光标置入正文、⠿ 拖 card 进盒子、完整自由拖放重排。
3. **语义样式 + 全局阅读偏好**：role 切换 UI（正文/小标题/引文/旁注的讲究排版）+ 全局字体/字号/行宽开关。
4. **Supabase 持久化 + 登录**：接「阅读陪伴」同一个 Supabase 项目与账号，替换 localStorage。

## Self-Review

- **Spec 覆盖**：本期对应 spec 第 3（河+软卡片模型）、第 4（两层骨架的"章"半边）、第 8（切分/合并/重排手势）、第 9（网页/数据模型的本地雏形）。颜色(5)、盒子(6)、排版(7)、Supabase(9) 明确列入后续期。无遗漏遗留在本期范围内。
- **占位符**：无 TBD；ProseMirror 命令的 pos 微调点已注明"以测试通过为准"，测试给了确切断言，非占位。
- **类型一致**：`cardId/threadId/role` 三属性、`splitCard/mergeCardBackward/moveCardUp/moveCardDown` 四命令、`useBookStore` 的 `addChapter/setActiveChapter/updateChapterDoc/getActiveChapter/__resetForTest`、`EMPTY_DOC`、`Chapter/Book` 类型在各任务间名称一致。
