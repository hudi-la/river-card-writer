# Phase 11 · 通用盒子（跨书流通） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 一个**库级"通用盒子"**——不属于任何一本书、跨所有书共享。**书柜**外层能打开它，**每本书的盒子列表最底部**也有它。卡片收进它 → 在别的书里能打开、置入正文，实现**跨文档流通**。

**Architecture:** `library.universalBox: Box`（默认 `{id:'__universal__', name:'通用盒子', cards:[]}`），存在库级、不在任何 `book.boxes` 里。`normalizeLibrary` 给缺它的老库补一个默认（迁移安全、只加不动）。所有盒子操作（getBox/parkCard/takeCardFromBox/carry）当 id 命中通用盒子时改作用于 `library.universalBox`。书柜里点它 → 新增 `shell:'universal'` 全屏 BoxView（＋"← 书柜"）；书内它作为盒子列表底部一项，`openBox('__universal__')` 进 BoxView（编辑器在场，可置入）。

**Tech Stack:** 沿用（React 19, TipTap v3, Zustand, Vitest）。

## Global Constraints
- 遵守[[card-writer-never-lose-books]]：通用盒子是**新增库级字段**，迁移只补默认、绝不动已有 books/boxes/内容。
- 通用盒子 id 固定 `'__universal__'`；盒子操作按 id 分派（命中通用 → 库级；否则 → 当前书的 boxes）。
- 跨书语义：`library.universalBox` 全局唯一，任何书打开看到同一批卡；置入用已有的装载光标流程（carry 现按 boxId 取卡，通用盒子走同一路径）。
- 不碰云同步映射之外的东西（`cw_books` 存的是每本书；通用盒子在 library 里，本地 localStorage 一定带；**云同步先只保证不丢本地**——若通用盒子暂不进云，也要在报告里说明，别声称同步了却没同步）。
- TDD：store 分派/迁移/跨书先写失败测试；两处 UI + 全屏视图靠浏览器验证。构建保持绿。

---

### Task 1: 库级通用盒子 + 盒子操作分派 + 迁移 + shell='universal'

**Files:** Modify `src/state/bookStore.ts`; Test `src/state/bookStore.test.ts`

**Interfaces:**
- `library.universalBox: Box`（默认 `{id:'__universal__', name:'通用盒子', cards:[]}`）。`UNIVERSAL_BOX_ID='__universal__'` 导出。
- `normalizeLibrary`：若 `raw.universalBox` 缺失/不合法 → 补默认；已有则保留。其它 books 一律不动。
- 盒子操作按 id 分派：`getBox(id)`（命中通用→返回 `library.universalBox`）、`parkCard(boxId,card)`、`takeCardFromBox(boxId,cardId)` 命中通用→读写 `library.universalBox.cards`；`carry(boxId,cardId)`/`dropCarried` 也支持通用 id（drop 时 take 走通用盒子的卡）。
- state `shell: 'shelf'|'book'|'universal'`；action `openUniversalBox()`（shell='universal'）；`goToShelf()` 从 universal 也回书柜。书内 `openBox('__universal__')` 照常（viewKind='box'、activeBoxId=通用 id）。
- 持久化：`universalBox` 随 library 存 `card-writer:library`。

- [ ] **Step 1: 失败测试** —— `bookStore.test.ts` 扩充：初始有 `universalBox`（空、默认名）；`parkCard('__universal__', card)` 进通用盒子而非某本书；**跨书**：openBook(A) 后 park 进通用，再 openBook(B)，`getBox('__universal__').cards` 仍含该卡（全局共享）；`openUniversalBox()` → shell='universal'；`normalizeLibrary` 对无 `universalBox` 的老库补默认且不动 books。

- [ ] **Step 2: 跑 `npm test -- bookStore`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 加 `universalBox` + `UNIVERSAL_BOX_ID`；盒子操作开头判断 `if (boxId===UNIVERSAL_BOX_ID)` 走库级分支；`normalizeLibrary` 补默认；`shell='universal'` + `openUniversalBox`。持久化路径带上 universalBox。

- [ ] **Step 4: 全量 `npm test`（引用旧 shell 联合类型的 UI 会红，留 Task 2；bookStore 绿）+ 记录待改文件。**

- [ ] **Step 5: 提交** `git commit -m "feat: library-level universal box + id-dispatch + migration + universal shell"`

---

### Task 2: 两处 UI —— 书柜通用盒子 + 每本书盒子底部 + 全屏视图

**Files:** Modify `src/ui/Bookshelf.tsx`, `src/ui/LeftNav.tsx`, `src/App.tsx`, `src/ui/BoxView.tsx`（若需接受通用盒子）, `src/styles.css`; Test `src/ui/Bookshelf.test.tsx`, `src/ui/LeftNav.test.tsx`

**Interfaces:**
- **LeftNav（书内）**：盒子组在本书的 boxes 之后、"＋新盒子"附近，加一项**通用盒子**（视觉上区分一下，如一个共享图标/浅分隔），点击 `openBox('__universal__')`。
- **Bookshelf（书柜）**：在书卡网格下方（用户圈的空白处）放一个**通用盒子**入口（一个带标识的卡片/条目，显示名+张数），点击 `openUniversalBox()`。
- **App**：`shell==='universal'` → 渲染全屏 `BoxView boxId='__universal__'` + `← 书柜`（goToShelf）。`shell==='book'` 时若 viewKind='box' 且 activeBoxId 是通用 id，Workspace 照常用 BoxView 显示（BoxView 用 getBox 拿到通用盒子，插入按钮走 carry）。
- BoxView 无需大改（它已按 boxId 用 getBox）；确认它对通用盒子也工作（在书内可置入、在 universal 全屏视图仅浏览/管理，因无编辑器）。

- [ ] **Step 1: 失败测试** —— `LeftNav.test.tsx`：盒子组渲染出"通用盒子"项、点击调 openBox(UNIVERSAL_BOX_ID)。`Bookshelf.test.tsx`：渲染出通用盒子入口、点击调 openUniversalBox 且 shell='universal'。

- [ ] **Step 2: 跑 `npm test -- LeftNav Bookshelf`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 两处入口 + App 的 universal 分支 + 样式（克制、和现有盒子/书卡风格一致）。恢复全量绿（修 Task 1 留下的 shell 类型引用）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证（截图仅绝对路径 `card-writer/.superpowers/sdd/screenshots/`）** —— ① 书 A 里把一张正文卡收进"通用盒子"；② 回书柜点通用盒子入口 → 看到那张卡；③ 打开书 B → 盒子底部通用盒子 → 打开 → 那张卡在 → 装载光标置入 B 的正文（跨文档流通成功）；④ 刷新还在。**提交** `git commit -m "feat: universal box entries on shelf + in each book (cross-document card flow)"`

---

## Phase 11 完成后
一个跨所有书的通用盒子，书柜和每本书底部都能进；卡片收进它就能在任何书里取用、置入正文——卡片真正跨文档流通。

## Self-Review
- 覆盖用户诉求（书柜+每本书底部的通用盒子、跨文档流通）：Task 1（库级数据+分派+迁移+universal shell）+ Task 2（两处 UI+全屏视图）。
- 数据安全：通用盒子新增库级字段、迁移只补默认；不动任何书/卡。
- 占位符：无 TBD；跨书/置入注明浏览器验证，store 给确切断言。
- 类型一致：`universalBox`/`UNIVERSAL_BOX_ID`/`shell:'shelf'|'book'|'universal'`/`openUniversalBox`、盒子操作分派 跨任务一致。
- 待确认坑：通用盒子是否入云同步——本期先保证本地不丢，云同步策略在报告里讲清，不虚报。
