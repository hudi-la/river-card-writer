# Phase 8 · 书柜（多本书） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 在现在"一本书"的编辑器之上加一层**书柜**：可以有好几本书，书柜页铺开所有书、点一本进去编辑、能新建/改名/删除书；现有的这本自动成为书柜里的第一本，内容不丢。

**Architecture:** store 从"单本 `book`"升级为"`library = { books: Book[], activeBookId: string|null }`"。`Book = { id, title, doc, boxes }`（不变）。顶层视图状态 `shell: 'shelf' | 'book'`：`shelf` 显示 `Bookshelf`（书卡网格），`book` 显示现有的 Workspace（左栏目录/盒子 + 编辑器）。旧数据 `card-writer:book`（单本）迁移进 `card-writer:library` 的 books[0]。每本书封面 = 由 id/标题派生的柔和渐变（呼应用户"纹理+三色渐变"审美）。

**Tech Stack:** 沿用（React 19, TipTap v3, Zustand, Vitest）。

## Global Constraints
- `Library = { books: Book[]; activeBookId: string | null }`，持久化 key `card-writer:library`。
- `Book = { id, title, doc, boxes }`（与现有一致）。
- 顶层 `shell: 'shelf'|'book'`；进书 = `openBook(id)`（shell='book'），回书柜 = `goToShelf()`（shell='shelf'）。
- 迁移：初始化时若无 `card-writer:library` 但有旧 `card-writer:book`，把它包成 `{ books:[该book], activeBookId:null }` 存进 library（并可保留旧 key 不动）。若两者都无 → 一本空书（EMPTY 内容），activeBookId=null（先落书柜）。
- 所有"当前书"的读写（doc、boxes、carry 等）都作用在 `books.find(activeBookId)` 上。
- 不引入 Supabase（下一阶段）。
- TDD：store 先写失败测试；书柜 UI 组件测试 + 浏览器验证。构建保持绿。

---

### Task 1: library store（多本书 + 迁移 + 当前书代理）

**Files:** Modify `src/state/bookStore.ts`; Test `src/state/bookStore.test.ts`

**Interfaces:**
- Produces:
  - 类型 `Library = { books: Book[]; activeBookId: string | null }`。
  - state：`library`、`shell: 'shelf'|'book'`（初始 'shelf'），以及现有的 `viewKind:'doc'|'box'`、`activeBoxId`、`carried`（这些现在是"当前书内"的状态）。
  - 派生：`activeBook(): Book | undefined` = `library.books.find(b=>b.id===library.activeBookId)`。
  - 书级 actions：`addBook(title?): Book`（新书含 EMPTY_DOC、空 boxes；返回它）、`openBook(id)`（activeBookId=id, shell='book', viewKind='doc'）、`goToShelf()`（shell='shelf'）、`renameBook(id,title)`、`deleteBook(id)`（若删的是当前书则回书柜）。
  - **改造现有 actions 作用于当前书**：`updateDoc(doc)`、`openBox`/`addBox`/`parkCard`/`takeCardFromBox`/`getBox`、`carry/cancelCarry/dropCarried` 都改成读写 `activeBook()` 里的字段（找到当前书、改它、写回 books、persist）。
  - `normalizeLibrary(raw)` + 迁移：优先读 `card-writer:library`；否则若有旧单本 `card-writer:book` → 包成 library；否则空 library（一本空书）。`load()` 走这套 + 形状 guard。
  - 保留 `EMPTY_DOC`、`__resetForTest`（重置成"一本空书、shell='shelf'"或按测试需要）。

- [ ] **Step 1: 失败测试** —— 重写/扩充 `bookStore.test.ts`：
  - 初始 `shell==='shelf'`；`addBook('新书')` 后 books+1；`openBook(id)` 后 `activeBook().id===id && shell==='book'`；`goToShelf()` 回 shelf。
  - `renameBook`/`deleteBook`（删当前书→回书柜、books-1）持久化到 `card-writer:library`。
  - **当前书代理**：`openBook` 后 `updateDoc(newDoc)` 只改当前书的 doc；`addBox`/`parkCard` 改当前书的 boxes；切到另一本书互不影响。
  - **迁移**：预置旧 `card-writer:book`（单本 {id,title,doc,boxes}）、无 library → 初始化后 library.books 含该书、内容深等。

- [ ] **Step 2: 跑 `npm test -- bookStore`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 按接口重写 store。把原来直接操作 `book` 的地方改成"取 activeBook → 改 → 写回 books 数组 → persist"。迁移函数仔细处理三种情况（有 library / 只有旧单本 / 都无）。

- [ ] **Step 4: 全量 `npm test`（其它引用旧 `book` 的组件/测试会红——RiverEditor/Workspace/LeftNav/BoxView 用 `book.doc`/`book.boxes`。本步让 bookStore 测试绿，其余留 Task 2 适配；列出待改文件）。**

- [ ] **Step 5: 提交** `git commit -m "feat: library store (multiple books) + migrate single book"`

---

### Task 2: 书柜 UI + 路由 + 适配当前书

**Files:** Create `src/ui/Bookshelf.tsx`; Modify `src/App.tsx`, `src/ui/Workspace.tsx`, `src/editor/RiverEditor.tsx`, `src/ui/LeftNav.tsx`, `src/ui/BoxView.tsx`, `src/styles.css`; Test `src/ui/Bookshelf.test.tsx`

**Interfaces:**
- `Bookshelf()`：书卡网格，每卡显示书名 + 渐变封面（`coverGradient(book.id)` 纯函数派生两三个柔和色）；点卡 `openBook(id)`；`＋ 新书` = `addBook()`→`openBook`；双击书名改名；每卡一个删除入口（点后需二次确认，如 `confirm()` 或行内确认）。空书柜显提示。
- `App`：`shell==='shelf'` → `<Bookshelf/>`；否则 `<Workspace/>`（编辑器），Workspace 顶部（或左栏顶）加 `← 书柜`（`goToShelf`）。
- 适配：RiverEditor/LeftNav/BoxView/Workspace 里 `useBookStore(s=>s.book.xxx)` 改成读 `activeBook()`（当前书）；`updateDoc` 等已在 Task 1 改成作用当前书，组件只需改数据来源。若无 activeBook（异常）安全回退到书柜。

- [ ] **Step 1: 失败测试** —— `Bookshelf.test.tsx`：library 里放两本书（标题 A/B）→ 渲染出两张书卡显示 A、B；点"＋ 新书"→ books+1 且 shell 变 'book'；点某卡 → openBook 且 shell='book'。（渐变封面/删除确认可浏览器验证。）

- [ ] **Step 2: 跑 `npm test -- Bookshelf`，确认 FAIL。**

- [ ] **Step 3: 实现** —— Bookshelf 组件 + App 路由 + `← 书柜` + 各编辑组件数据源改 `activeBook()`。`coverGradient` 用 id 哈希取两三个低饱和色做 `linear-gradient`（呼应纹理+三色渐变审美，克制好看）。CSS：`.shelf`、`.book-card`、`.book-cover`、`.book-title`、`.shelf-add`、`.back-to-shelf`。

- [ ] **Step 4: 全量 `npm test` + `npm run build`（必须全绿）。**

- [ ] **Step 5: 浏览器手动验证** —— `npm run dev` + Playwright（截图存**绝对路径** `card-writer/.superpowers/sdd/screenshots/`）：书柜铺开多本书（渐变封面）、＋新书、点进去编辑、← 书柜返回、两本书内容互不串、刷新还在。**提交** `git commit -m "feat: bookshelf UI + shell routing + per-book state"`

---

## Phase 8 完成后
打开先见**书柜**：几本书各有渐变封面，点一本进去就是现在这套连续文档编辑器；← 书柜回来；新建/改名/删书都有；每本书的内容/盒子各自独立、刷新不丢。旧的单本自动进了书柜。

## Self-Review
- 覆盖"好几本书 + 书柜页"：Task 1（多本 store+迁移+当前书代理）+ Task 2（书柜 UI + 路由 + 适配）。
- 破坏性：单本→多本改了 store，Task 2 必须把所有读 `book` 的组件改到 `activeBook()` 并恢复全绿。
- 占位符：无 TBD；渐变/确认交互注明浏览器验证，测试断言 store 状态与书卡渲染。
- 类型一致：`Library`/`books`/`activeBookId`/`shell`/`activeBook()`/`openBook`/`goToShelf`/`addBook`/`renameBook`/`deleteBook`/`coverGradient` 跨任务一致。
