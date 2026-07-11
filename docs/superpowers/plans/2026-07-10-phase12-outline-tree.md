# Phase 12 · 目录变成可编辑的树（列块 + 预览/说明 + 便签贴题 + 拖动重排）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把左栏「目录」从"只列章/节标题"升级为**完整的树**：章/节/二级标题下**列出各自的块（卡片）**；每个列出来的块显示**前几个字预览、写了说明就显示说明**；hover 说明便签**贴着标题/块**出现（不再飘到整行 block 右边）；在目录里能**拖动章/节/块上下换顺序**（章带整段一起移）。

**Architecture:** 目录树由纯函数 `outlineTreeFromDoc(doc)` 从 `book.doc` 派生：按 doc 里的 card 顺序走，含 heading 段（chapter/h1/h2）的 card 是**标题行**（对应层级），其余 card 是**块行**（缩进挂在当前标题下）。说明存储：标题行用已有的**标题段落 `note`**（Phase 10，不动）；块行用**新增的 card 节点 `note` 属性**（默认 ''、零迁移、遵守[[card-writer-never-lose-books]]）。预览=块内纯文本前若干字。拖动重排复用/扩展 `moveCardTo`：块→移该 card；章/节→移"该标题 card + 其后直到下一个同级或更高级标题之前的所有 card"（整段）。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。

## Global Constraints
- 数据安全铁律：card 加 `note` 是**新增默认空属性**，不改任何已有正文；标题 note 仍在段落上，不迁移不动。
- `outlineTreeFromDoc(doc)` 返回有序行：`{ level:1|2|3, kind:'heading'|'block', text:string, note:string, preview:string, cardIndex:number }`（cardIndex=该行对应 card 在 doc.content 里的下标；heading 的 level 按 chapter=1/h1=2/h2=3）。
- 编辑说明统一走 `editorBridge`（保持编辑器是 doc 唯一真源）：标题→已有 `setHeadingNote`；块→新增命令 `setCardNote(cardIndex, note)`。
- 拖动重排在目录里进行，落到编辑器 doc 上（命令式），不直接改 store doc。
- 不碰云同步/存储格式其它部分。
- TDD：纯函数/命令先写失败测试；渲染/便签定位/拖动靠浏览器验证。构建保持绿。

---

### Task 1: 数据层 —— card note 属性 + setCardNote 命令 + outlineTreeFromDoc + 预览

**Files:** Modify `src/editor/schema.ts`（card 加 note + 命令）, `src/ui/LeftNav.tsx`（新增 outlineTreeFromDoc 导出，可与旧 outlineFromDoc 并存或替换）; Test `src/editor/cardNote.test.ts`, `src/ui/outlineTree.test.ts`

**Interfaces:**
- card 节点加 `note`（string, default ''，parse/render `data-card-note`；仅元数据不显示正文）。
- 命令 `setCardNote(cardIndex: number, note: string)`：定位 doc.content 第 cardIndex 个 card，设其 note。加入 declare-module。
- `outlineTreeFromDoc(doc): OutlineRow[]`（见 Global Constraints 的行结构）。heading 的 text=标题文本、note=标题段 note；block 的 text=块纯文本、note=card note、preview=纯文本前 ~14 字（空块→''）。
- 纯文本抽取 helper（复用 BoxView 里已有的）。

- [ ] **Step 1: 失败测试** —— `cardNote.test.ts`：`setCardNote(1,'块说明')` 设第 2 个 card 的 note、别的不变；默认 ''。`outlineTree.test.ts`：构造 doc=[章A卡, 正文卡1, 正文卡2, 节B卡, 正文卡3]，`outlineTreeFromDoc` 返回 5 行、层级/kind/preview/cardIndex 正确、块行挂在对应标题下（缩进层级=标题层级+1）。

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现。**

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: card note attr + setCardNote + outlineTreeFromDoc + preview"`

---

### Task 2: 目录树渲染 + 说明便签贴题 + 预览/说明 + 详细视图

**Files:** Modify `src/ui/LeftNav.tsx`, `src/styles.css`, `src/state/editorBridge.ts`（加 setCardNote 便捷）; Test `src/ui/LeftNav.test.tsx`

**Interfaces:**
- LeftNav 目录组改用 `outlineTreeFromDoc`：渲染标题行（按层级缩进、加粗程度递减）+ 其下的块行（再缩进）。点标题行仍滚动到该标题；点块行滚动到该块。
- **每行显示**：有 note→显示 note；否则 heading 显示标题文本、block 显示 preview（前几个字）。空块 preview 为空时显示淡"（空块）"。
- **hover 便签贴题**（修 #1）：浮层用 fixed 定位，`left` 取**该行文字末端右侧一点点**（量文字所在元素的 rect，而不是整行 block 的右边/rail 右缘），vertically 对齐该行；编辑保存：heading→`editorBridge.setHeadingNote(headingIndex,...)`；block→`editorBridge.setCardNote(cardIndex,...)`。保持"移进便签能打字不消失"。
- **详细视图**：每行把 note 输入框铺出来（沿用现有详细视图，扩展到块行）。
- 简略/详细切换、盒子组、盒内卡片列表（上一阶段）不受影响。

- [ ] **Step 1: 失败测试** —— `LeftNav.test.tsx`：给一个含"章+两个正文块"的 doc，目录渲染出标题行 + 两个块行（块行显示预览文字）；某块写了 note 后该行显示 note；点块行的便签编辑调 `editorBridge.setCardNote`。

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现**（含便签定位改为贴文字）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证（截图仅绝对路径 `card-writer/.superpowers/sdd/screenshots/`）** —— 目录列出章/节下的块（带预览）；hover 某行便签**紧贴标题**出现、可编辑；写了说明后该行显示说明；详细视图每行铺出说明框。**提交** `git commit -m "feat: outline tree renders blocks with preview/note, notepad hugs the title"`

---

### Task 3: 目录内拖动重排（章带整段 / 节 / 块）

**Files:** Modify `src/ui/LeftNav.tsx`, `src/editor/schema.ts`（加"移动整段"命令）, `src/styles.css`; Test `src/editor/moveSection.test.ts`, `src/ui/LeftNav.test.tsx`

**Interfaces:**
- 命令 `moveCardTo(cardIndex, targetIndex)` 已有（移单个 card）——块行拖动用它。
- 新增命令 `moveSection(headingCardIndex, targetIndex)`：把"该标题 card + 其后直到下一个 level≤当前的标题之前的所有 card"整段搬到目标位置。TDD 覆盖：移动章把它整段（标题+正文块+子节）一起搬。
- LeftNav 目录行支持拖动：抓某行上下拖 → 行间落点线 → 松手：块行→`moveCardTo`；标题行→`moveSection`。用与正文 ⠿ 拖拽类似的命令式实现（fixed ghost + 落点线 + sticky 目标），但落点是"目录里另一行之间"。

- [ ] **Step 1: 失败测试** —— `moveSection.test.ts`：doc=[章1, 卡a, 节1.1, 卡b, 章2, 卡c]，`moveSection(章2的index, 0)` 后顺序变成 [章2, 卡c, 章1, 卡a, 节1.1, 卡b]（章2 整段移到最前、章1 整段保持）。块单移用 moveCardTo 的既有测试。

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现** moveSection + LeftNav 目录行拖动（复用拖拽骨架：阈值、ghost、落点线、sticky、多事件收尾、幂等）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证** —— 目录里拖一个块换位（正文对应块跟着移）；拖一个节换位；拖一个章→它底下整段一起移；正文顺序与目录一致。**提交** `git commit -m "feat: drag-reorder chapters(with section)/sections/blocks inside the outline"`

---

## Phase 12 完成后
目录是一棵可读可编辑可重排的树：章/节/二级下列出各自的块（预览或说明）；便签贴着标题；拖动章/节/块就改正文顺序（章带整段）。

## Self-Review
- 覆盖用户四条：#1 便签贴题(Task2)、#2 列块(Task1/2)、#3 预览直到写说明(Task1/2)、#4 目录内拖动重排(Task3)。
- 数据安全：card note 新增默认空；标题 note 不迁移；拖动走命令式落到 doc。
- 占位符：无 TBD；便签定位/拖动注明浏览器验证，纯函数/命令给确切断言。
- 类型一致：card `note`、`setCardNote`、`outlineTreeFromDoc`/`OutlineRow`、`moveSection`、`editorBridge.setCardNote` 跨任务一致。
