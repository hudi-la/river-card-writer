# Phase 7 · 连续文档 + 段落样式 + 选中工具条 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把工具从"每章一个独立文档 + 右侧图标簇 + 线色带"重构为用户拍板的新模型：**整本书一条从头到尾的连续河**；"章/节"是段落样式（左栏目录自动从中生成、点击滚动）；样式与颜色通过**选中文字浮出的工具条**操作；结构操作走键盘；卡片底色每张不同（自动+手动）。

**Architecture:**
- **一个连续文档**：`book.doc`（一个大 ProseMirror doc = `card+`），不再有 `chapters[]`、不再切页。旧数据迁移：各章 doc 的卡片首尾相连，章标题转成「章」样式段落。
- **段落样式**在 `paragraph` 节点的 `style` 属性上（body/chapter/h1/h2）；**行内样式**是两个 mark（emphasis=加粗+彩色、refer=斜体+加粗）。
- **卡片**只保留 `cardId` + `color`（hex 或 null；null=按 cardId 哈希自动取色）。去掉 card 的 `role`/`threadId` 与整套"线/thread"系统。
- **左栏**从"章列表"变成**目录/大纲**（扫描 doc 里 style=chapter/h1 的段落，点击滚动到位）+ 盒子组。
- **交互**：删掉 `.card-ctrls` 全部图标与 thread/box/role 菜单；结构操作用键盘（Cmd+↑↓ 移动、Cmd+Enter 分割/加卡、退格/Delete 合并）；⠿ 河里拖=重排、拖到左栏盒子=收纳；样式/颜色用 **选中出现的 BubbleMenu**。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。选中工具条用 TipTap v3 的 BubbleMenu（`@tiptap/react` 的 `BubbleMenu`，或 `@tiptap/extension-bubble-menu`——以 v3 实际可用为准，装好即可）。

## Global Constraints
- `paragraph` 加 `style` 属性：`'body'|'chapter'|'h1'|'h2'`，默认 `'body'`，渲染 `data-style`。
- 两个 mark：`emphasis`（渲染加粗+彩色）、`refer`（渲染加粗+斜体）；命令 `toggleEmphasis`/`toggleRefer`。
- `card` 属性：`cardId`（不变）、`color`（string|null，null→哈希 cardId 取调色板色）。**移除 card 的 `role` 与 `threadId`**。
- 文档 = 一个 `book.doc`（`doc` content `card+`）；`normalizeBook` 迁移旧 `chapters[]`。boxes 保留。移除 threads 与 chapter 相关状态/动作。
- 颜色 = **整张卡底色**；默认自动（每卡不同），可手动色块改。
- 章与章之间不换页、线性排；左栏"章"=从 style=chapter 的段落生成的目录。
- 键盘：`Cmd/Mod+ArrowUp/Down` 移动卡、`Mod+Enter` 分割/加卡、`Backspace`(卡首)/`Delete` 合并。
- TDD：schema/store/命令先写失败测试；BubbleMenu、目录滚动、拖到盒子等交互组件测试 + 浏览器手动验证。
- 保持 `npm run build` 干净。删除随之无用的测试（旧 chapter/thread 测试）要一并更新，不许留悬空引用。

---

### Task 1: schema 重构 —— 段落样式 + 两个行内 mark + 每卡底色

**Files:** Modify `src/editor/schema.ts`; Create `src/editor/marks.ts`（可选，或并进 schema.ts）; Test `src/editor/paragraphStyle.test.ts`, `src/editor/marks.test.ts`, `src/editor/cardColor.test.ts`

**Interfaces:**
- Produces:
  - `paragraph` 节点带 `style` 属性（默认 'body'；渲染 `data-style`）。命令 `setParagraphStyle(style)`（作用于光标所在段落；选区跨多段时全部设）。
  - 两个 mark：`Emphasis`（`toggleEmphasis`，渲染 `<strong class="em">`）、`Refer`（`toggleRefer`，渲染 `<em class="refer">`）。加入 baseExtensions。
  - `card` 属性改为 `{ cardId, color }`（移除 role/threadId）。命令 `setCardColor(color: string | null)`。
  - 导出 `autoCardColor(cardId: string): string`（哈希 cardId → `THREAD_PALETTE` 取色；调色板从 bookStore 或本文件导出一个 `CARD_PALETTE`）。
  - 更新 `declare module` 的 command 接口：加 `setParagraphStyle`、`toggleEmphasis`、`toggleRefer`、`setCardColor`；移除 `setCardThread`、`setCardRole`（若其它任务还引用需一并清）。

- [ ] **Step 1: 失败测试** —— 三个文件分别测：
  - `paragraphStyle.test.ts`：光标在一段，`setParagraphStyle('chapter')` 后该段 `attrs.style==='chapter'`；设回 'body'。
  - `marks.test.ts`：选中一段文字，`toggleEmphasis()` 后该区间有 emphasis mark；再 toggle 去掉；`toggleRefer` 同理；两者可叠加。
  - `cardColor.test.ts`：`setCardColor('#d98b7a')` 后光标所在 card `attrs.color==='#d98b7a'`；`setCardColor(null)` 清空；`autoCardColor('abc')` 稳定返回调色板里的某个 hex，且不同 id 多半不同。

- [ ] **Step 2: 跑 `npm test -- paragraphStyle marks cardColor`，确认 FAIL。**

- [ ] **Step 3: 实现** ——
  - `Paragraph` 用 `Paragraph.extend({ addAttributes(){ return { style:{ default:'body', parseHTML:el=>el.getAttribute('data-style')||'body', renderHTML:a=>({'data-style':a.style}) } } } })`（在 baseExtensions 里用这个扩展版替换原 Paragraph）。命令 `setParagraphStyle` 用 `setNodeMarkup`/遍历选区段落设 attr。
  - `marks.ts`：两个 `Mark.create`，`emphasis`（renderHTML `['strong',{class:'em'},0]`）、`refer`（`['em',{class:'refer'},0]`），各带 `addCommands` 的 toggle + 可选快捷键。
  - `Card`：`addAttributes` 改为 `cardId` + `color`（`color` default null，parse/render `data-color`）；删掉 role/threadId。`setCardColor` 命令 setNodeAttribute。删掉 `setCardThread`/`setCardRole`（及被删属性的引用）。
  - `autoCardColor`：简单字符串哈希（如逐字符 charCode 累加）% 调色板长度。
  - baseExtensions：`[CardDocument, Card, ParagraphWithStyle, Text, Emphasis, Refer, assignCardIds, ...(placeholder 等保留)]`。（doc content 仍 `card+`；card content 仍 `paragraph+`。）

- [ ] **Step 4: 跑三个测试 + 全量 `npm test` + `npm run build`。**（会有旧测试因删了 setCardThread/role/threadId 而失败——一并删除/改写那些测试文件，使全绿。）

- [ ] **Step 5: 提交** `git commit -m "feat: paragraph styles + emphasis/refer marks + per-card color (drop thread/role)"`

---

### Task 2: 单文档 store + 旧数据迁移

**Files:** Modify `src/state/bookStore.ts`; Test `src/state/bookStore.test.ts`（重写相关用例）

**Interfaces:**
- Produces:
  - `Book = { id: string; title: string; doc: any; boxes: Box[] }`（一个大 doc；无 chapters/threads）。
  - state：`book`、`viewKind: 'doc'|'box'`、`activeBoxId: string|null`、`carried`。
  - actions：`updateDoc(doc)`、`openDoc()`（viewKind='doc'）、`openBox(id)`、`addBox(name)`、`parkCard(boxId, json)`、`takeCardFromBox(boxId, cardId)`、`getBox(id)`、`carry/cancelCarry/dropCarried`（不变语义）。
  - `EMPTY_DOC`（一个含单个空 card 的 doc）。
  - `normalizeBook(raw)`：① 新格式（有 `doc`）直接用；② 旧格式（有 `chapters[]`）→ 迁移：对每章生成 `[ 章标题卡, ...该章的卡 ]` 顺次拼进一个大 doc；章标题卡 = `{card > paragraph(style:'chapter', text:章title)}`；boxes 保留；丢弃 threads/activeChapterId。缺 boxes 补 []。
  - 移除：`chapters`、`activeChapterId`、`addChapter`/`renameChapter`/`setActiveChapter`/`updateChapterDoc`/`getActiveChapter`、`threads`/`addThread`/`getThread`、`THREAD_PALETTE`（若颜色调色板改放 schema/常量文件，更新引用）。

- [ ] **Step 1: 失败测试** —— 重写 `bookStore.test.ts`：初始有 `doc`（EMPTY_DOC 等价）、`viewKind==='doc'`；`updateDoc` 持久化；boxes 动作照旧；**迁移测试**：`normalizeBook({chapters:[{title:'一',doc:{...卡A}},{title:'二',doc:{...卡B}}], boxes:[...]})` → 返回的 `doc.content` 是 `[章'一', 卡A, 章'二', 卡B]`（章段 style==='chapter'、文本正确），boxes 保留；新格式 `normalizeBook({doc:{...}})` 原样返回 + 补 boxes。

- [ ] **Step 2: 跑 `npm test -- bookStore`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 按接口重写 store（persist/load/__resetForTest 保留，load 走 normalizeBook + 形状 guard）。迁移函数仔细构造章标题卡。

- [ ] **Step 4: 跑 `npm test -- bookStore` + 全量（其它引用旧 chapter API 的测试/代码会红——留到 Task 3 一起改；本步至少让 bookStore 自己的测试绿，全量红的项记下）。**

- [ ] **Step 5: 提交** `git commit -m "feat: single continuous doc store + migrate old chapters"`

---

### Task 3: 编辑器接单文档 + 删图标簇 + 键盘 + 拖到盒子

**Files:** Modify `src/editor/RiverEditor.tsx`, `src/editor/CardView.tsx`, `src/ui/Workspace.tsx`, `src/editor/schema.ts`(键盘), `src/styles.css`; 删除或改写引用旧 API 的测试; Test `src/editor/moveCardKbd.test.ts`, 更新 `CardView.test.tsx`

**Interfaces:**
- RiverEditor 改为渲染 `book.doc`（`useBookStore(s=>s.book.doc)`），`onUpdate` → `updateDoc(editor.getJSON())`；不再有 `chapterId` prop。
- CardView：**移除整个 `.card-ctrls` 簇与 thread/box/role 菜单**；卡片渲染 = `section.card` + 背景色（`color` 属性或 `autoCardColor(cardId)`）+ `NodeViewContent` + 保留 ⠿ 拖拽。加 `data-color`/inline `--card-bg`。
- 键盘（schema `addKeyboardShortcuts` on Card）：`Mod-ArrowUp`→moveCardUp、`Mod-ArrowDown`→moveCardDown、`Mod-Enter`→splitCard（保留）、`Backspace`→mergeCardBackward（保留）。（移除 Alt-Arrow 或保留皆可，以 Cmd 为主。）
- ⠿ 拖拽：河内重排保留；**新增拖到左栏盒子**——RiverEditor 的拖拽逻辑在 pointerup 命中左栏某 `[data-box-id]` 元素时，改为 `parkCard(boxId, 该卡JSON)` + `removeCard()`（而非重排）。
- Workspace：`viewKind==='box'` 渲染 BoxView，否则渲染 RiverEditor（单文档）。

- [ ] **Step 1: 失败测试** —— `moveCardKbd.test.ts`：三张卡，光标在中卡，模拟 `Mod-ArrowDown` 命令路径（可直接调 `editor.commands.moveCardDown()` 验证命令，键盘绑定用浏览器验证）；更新 `CardView.test.tsx`：卡片渲染出 `section.card`、带背景色属性、**不再有** `[data-card-ctrl]` 任何按钮。

- [ ] **Step 2: 跑 `npm test -- moveCardKbd CardView`，确认 FAIL（含"不应再有 data-card-ctrl"这类新断言）。**

- [ ] **Step 3: 实现** —— 精简 CardView；改 RiverEditor 接单文档 + 拖到盒子分支；改 Workspace；键盘绑定。**删除/改写**所有引用旧 chapter/thread/role/cluster 的组件与测试（ChapterRail 的 chapter 部分见 Task 4；thread/box/role 菜单测试删除；insert/carry 等保留但适配单文档）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`（此后应恢复全绿）。**

- [ ] **Step 5: 提交** `git commit -m "feat: single-doc editor, drop control cluster, keyboard ops, drag-to-box"`

---

### Task 4: 左栏目录（大纲）+ 盒子

**Files:** Modify/rename `src/ui/ChapterRail.tsx` → `src/ui/LeftNav.tsx`; Modify `src/ui/Workspace.tsx`; Test `src/ui/LeftNav.test.tsx`

**Interfaces:**
- `LeftNav`：
  - **目录组**：扫描 `book.doc`，取出所有 `paragraph[style==='chapter']`（章）与可选 `[style==='h1']`（节）作为大纲项（章一级、节二级缩进），显示其文本；点击 → 滚动编辑器到对应段落（用一个 ref/回调把"scrollToPos"从 RiverEditor 暴露，或用 `document` 查询 `[data-style="chapter"]` 的第 n 个并 `scrollIntoView`）。空文档显淡提示。
  - **盒子组**：boxes 列表（`openBox`）、`＋ 新盒子`（addBox→openBox）。每个盒子项带 `data-box-id`（供 Task 3 拖放命中）。
  - 移除 chapter 列表/新增/改名。
- Workspace 渲染 `<LeftNav/>`。

- [ ] **Step 1: 失败测试** —— `LeftNav.test.tsx`：给 store 一个含两个 `style:'chapter'` 段落（文本"一"、"二"）的 doc，断言目录里出现"一""二"；点"新盒子"→ boxes+1、viewKind==='box'；空文档时目录区显提示。（滚动行为用浏览器验证。）

- [ ] **Step 2: 跑 `npm test -- LeftNav`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 大纲从 doc 派生（一个纯函数 `outlineFromDoc(doc): {level, text, index}[]` 便于测试）；点击滚动用 `data-style="chapter"`/`h1` 的 DOM 节点按序 `scrollIntoView`。盒子组照旧、加 `data-box-id`。

- [ ] **Step 4: 跑 `npm test -- LeftNav` + 全量 + `npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: left outline nav from chapter/section headings + boxes"`

---

### Task 5: 选中工具条（BubbleMenu）—— 样式 + 行内 + 颜色

**Files:** Create `src/editor/SelectionToolbar.tsx`; Modify `src/editor/RiverEditor.tsx`, `src/styles.css`; Test `src/editor/SelectionToolbar.test.tsx`（能测的部分）

**Interfaces:**
- 用 TipTap v3 BubbleMenu：非空选区时浮出一条工具条，含：
  - **块级样式**：正文 / 章 / 一级小标题(节) / 二级小标题 → `setParagraphStyle('body'|'chapter'|'h1'|'h2')`（作用于选区所在段），当前样式高亮。
  - **行内**：强调（`toggleEmphasis`）、refer（`toggleRefer`），激活态高亮。
  - **颜色**：几个色块（`CARD_PALETTE` + 一个"自动/清除"）→ `setCardColor(hex|null)`，作用于**选区所在的整张卡**。
- 挂进 RiverEditor（BubbleMenu 需要 editor 实例）。

- [ ] **Step 1: 失败测试** —— `SelectionToolbar.test.tsx`：渲染带 BubbleMenu 的编辑器，直接调用工具条按钮的 handler（或渲染组件传入 mock editor）验证点"章"调 `setParagraphStyle('chapter')`、点"强调"调 `toggleEmphasis`、点某色块调 `setCardColor(hex)`。（BubbleMenu 的浮现定位靠浏览器验证，不强测。）

- [ ] **Step 2: 跑 `npm test -- SelectionToolbar`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 装/引入 BubbleMenu（确认 v3 包名）；`SelectionToolbar` 组件按接口出按钮；样式克制好看（沿用 --paper/--hair 那套浮层风格）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证** —— `npm run dev` + Playwright（截图存 **绝对路径** `card-writer/.superpowers/sdd/screenshots/`）：① 选中一行 → 工具条浮出 → 设"章"（变最大、左栏目录出现该标题）、设"节"、"二级"；② 选几个字 → 强调（加粗彩色）、refer（斜体加粗）；③ 点色块 → 整张卡底色变；④ 目录点击滚动；⑤ ⠿ 拖卡到盒子 → 收纳。**提交** `git commit -m "feat: selection BubbleMenu for paragraph styles, inline marks, card color"`

---

## Phase 7 完成后
一条连续的书：一直往下写，章/节是段落样式、左栏目录自动生成可跳转；选中文字冒出工具条改样式/行内强调/refer/整卡底色；卡片默认各有淡底色、可手动改；结构操作全键盘，⠿ 拖动重排或拖进盒子；右侧图标簇彻底消失。

## Self-Review
- 覆盖用户新规格：连续文档(Task 2/3/4)、段落样式章/正文/节/二级(Task 1/5)、行内强调+refer(Task 1/5)、每卡底色自动+手动(Task 1/3/5)、删图标+键盘+拖到盒子(Task 3)、目录联动跳转(Task 4)。
- 破坏性：删除 chapters/threads/role/cluster 及其测试——各任务明确要求同步删改，Task 3/4 后必须全量绿。
- 占位符：无 TBD；ProseMirror/BubbleMenu 具体 API 注明"以 v3 实际为准/以测试为准"，测试给确切断言。
- 类型一致：`style`(段落)、`emphasis`/`refer`(mark)、`color`(card)、`setParagraphStyle`/`toggleEmphasis`/`toggleRefer`/`setCardColor`、`viewKind:'doc'|'box'`、`outlineFromDoc`、`data-box-id`、`autoCardColor`/`CARD_PALETTE` 跨任务一致。
