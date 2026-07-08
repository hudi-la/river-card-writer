# Phase 4 · 盒子 + 置入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 左栏第二组"盒子"（手动建、命名的暂存区）；把正文里的卡片**收进盒子**、把盒子里的卡片用 **InDesign 式装载光标置入正文**。让"篇与篇之外的备用素材"有地方放、能回流。

**Architecture:** 盒子存 book 层（`book.boxes: Box[]`，`Box = { id, name, cards: CardJSON[] }`，`CardJSON` = 一个 card 节点的 ProseMirror JSON，含 threadId/正文，可原样塞回河里）。左栏从"只有章"升级为**两组可折叠导航**（章 + 盒子）；主区按 `viewKind` 显示 `RiverEditor`（章）或 `BoxView`（盒子）。收纳 = 删掉河里的卡 + 把它的 JSON 存进盒子。置入 = "装载"一张盒中卡到 store 的 `carried`，切到某章，河里出现落点提示，点某卡后把它作为新卡插入、并从盒子移走。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。

## Global Constraints
- `Box = { id: string; name: string; cards: CardJSON[] }`；`CardJSON` 是 `{ type:'card', attrs:{cardId,threadId,role}, content:[...] }`。
- book 加 `boxes: Box[]`；`normalizeBook` 补 `boxes: []`（旧数据迁移）。
- 导航状态：store 加 `viewKind: 'chapter' | 'box'` 与 `activeBoxId: string | null`；`openChapter(id)` / `openBox(id)` 切换。保留 `activeChapterId`。
- 收纳/置入都是**移动**（不留副本）：收进盒子 → 从河删除；置入正文 → 从盒子删除。
- 不引入语义样式 UI（Phase 5）、Supabase。颜色/线随卡一起走（CardJSON 带 threadId）。
- TDD：store 动作、editor 命令先写失败测试；纯视图（BoxView、装载光标横幅）组件测试 + 浏览器手动验证。

---

### Task 1: store —— boxes 数据 + 导航状态

**Files:** Modify `src/state/bookStore.ts`; Test `src/state/bookStore.test.ts`

**Interfaces:**
- Produces:
  - 类型 `Box = { id: string; name: string; cards: any[] }`；`Book` 加 `boxes: Box[]`。
  - `normalizeBook` 补 `boxes: Array.isArray(raw.boxes) ? raw.boxes : []`。
  - state: `viewKind: 'chapter' | 'box'`（初始 'chapter'），`activeBoxId: string | null`（初始 null）。
  - actions:
    - `addBox(name: string): Box`（持久化，返回它）
    - `openChapter(id: string): void`（设 `viewKind:'chapter'`, `activeChapterId:id`）
    - `openBox(id: string): void`（设 `viewKind:'box'`, `activeBoxId:id`）
    - `parkCard(boxId: string, cardJSON: any): void`（把 cardJSON 追加进该盒 cards，持久化）
    - `takeCardFromBox(boxId: string, cardId: string): any | undefined`（从盒里移除并返回该 cardJSON；持久化）
    - `getBox(id: string | null): Box | undefined`
  - `freshBook()` 加 `boxes: []`。

- [ ] **Step 1: 失败测试** — `bookStore.test.ts` 追加：初始 `boxes: []` 且 `viewKind==='chapter'`；`addBox('素材')` 后长度 1、持久化；`openBox(id)` 设 viewKind='box'+activeBoxId；`parkCard` 追加一张卡 JSON 到盒；`takeCardFromBox` 移除并返回它、盒里少一张；`normalizeBook` 对无 boxes 旧数据补 `[]`。（每条一个 `it`，断言 store 状态 + localStorage 内容。）

- [ ] **Step 2: 跑 `npm test -- bookStore`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 加类型与 action，模式同 `addThread`/`renameChapter`（`persist(book); set({book})`）。`takeCardFromBox`：找到盒、`const card = box.cards.find(c=>c.attrs.cardId===cardId)`、过滤掉它、持久化、返回 card。`BookState` 类型补全新字段/动作。`freshBook`/`normalizeBook` 补 `boxes`。

- [ ] **Step 4: 跑 `npm test -- bookStore`，全量 `npm test`。**

- [ ] **Step 5: 提交** `git commit -m "feat: boxes + view-kind navigation in store"`

---

### Task 2: 左栏两组导航（章 + 盒子）+ 主区分流

**Files:** Modify `src/ui/ChapterRail.tsx`（改成 `LeftNav`，或在内部加第二组）, `src/ui/Workspace.tsx`, `src/styles.css`; Test `src/ui/LeftNav.test.tsx`

**Interfaces:**
- Consumes: store（chapters、boxes、viewKind、activeChapterId、activeBoxId、addChapter、addBox、openChapter、openBox、renameChapter）。
- Produces:
  - 左栏两组：**章**（点=openChapter；保留双击改名；＋新一章）与 **盒子**（点=openBox；＋新盒子），各组可折叠。
  - `Workspace` 依 `viewKind` 渲染 `RiverEditor key={activeChapterId}`（chapter）或 `BoxView key={activeBoxId}`（box，Task 3）。

- [ ] **Step 1: 失败测试** — `LeftNav.test.tsx`：渲染后能看到"章"与"盒子"两个分组标题；点"＋ 新盒子"后 store.boxes +1；点某盒子后 `viewKind==='box'`。（章的既有行为——切换/改名——保持，测一条回归。）

- [ ] **Step 2: 跑 `npm test -- LeftNav`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 把 `ChapterRail` 扩成 `LeftNav`（保留原 class；文件可仍叫 ChapterRail.tsx 或改名，二选一并更新 import）。加"盒子"组：`boxes.map` → 可点项（`openBox(b.id)`，active 高亮用 `activeBoxId===b.id && viewKind==='box'`）、`＋ 新盒子`（`const b=addBox('新盒子'); openBox(b.id)`）。章项点击改为 `openChapter(id)`。`Workspace.tsx` 用 `viewKind` 分流渲染。CSS 加分组标题 `.nav-group`、折叠箭头（可选，先不折叠也行，但标题要有）。

- [ ] **Step 4: 跑 `npm test -- LeftNav Workspace`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: left nav with chapters + boxes groups"`

---

### Task 3: BoxView —— 盒子打开视图（缩略图铺法）

**Files:** Create `src/ui/BoxView.tsx`; Modify `src/styles.css`; Test `src/ui/BoxView.test.tsx`

**Interfaces:**
- Consumes: store（getBox、activeBoxId）。
- Produces: `BoxView({ boxId })` —— 标题（盒名 + 张数）+ 缩略图网格：每张卡一个 `.tcard`，显示正文文字预览（取 card JSON 里的纯文本）+ 右下角一个 `[data-box-action="insert"]` 的"⤵ 插入正文"按钮（Task 5 接线）。空盒显提示"这个盒子还是空的"。

- [ ] **Step 1: 失败测试** — `BoxView.test.tsx`：往 store 加一个盒并 `parkCard` 两张带文字的卡；渲染 `<BoxView boxId=.../>`，断言：两个 `.tcard`、能看到两张卡的文字、两个 `[data-box-action="insert"]` 按钮；空盒时显示空提示。

- [ ] **Step 2: 跑 `npm test -- BoxView`，确认 FAIL。**

- [ ] **Step 3: 实现** —— `BoxView.tsx`：`const box = useBookStore(s=>s.getBox(boxId))`；抽纯文本 helper `cardText(cardJSON)`（遍历 paragraph→text 拼接）。渲染网格。按钮先只带 `data-box-action="insert"` 和 `data-card-id`，onClick 占位（Task 5 接 `carry`）。CSS：`.box-view`、`.tcard`（小卡片，圆角边框，文字截断）、`.box-empty`。

- [ ] **Step 4: 跑 `npm test -- BoxView`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: BoxView thumbnail grid"`

---

### Task 4: 收进盒子（正文卡 → 盒子）

**Files:** Modify `src/editor/schema.ts`（加 `removeCard` 命令）, `src/editor/CardView.tsx`（加"⇢盒子"按钮 + 菜单）, `src/styles.css`; Test `src/editor/removeCard.test.ts`, `src/editor/CardToBox.test.tsx`

**Interfaces:**
- Produces:
  - editor 命令 `removeCard()` —— 删除光标所在 card（若是最后一张则不删、返回 false，保住"至少一张卡"不变量）。加入 `declare module` card 接口。
  - CardView 控制簇加 `data-card-ctrl="tobox"` 的"⇢"按钮，点开盒子菜单（列出 boxes + "＋新盒子"），选中某盒 → 把本卡 JSON `parkCard(boxId, json)` 再 `removeCard()`（顺序：先取 JSON、park、再删）。

- [ ] **Step 1: 失败测试（命令）** — `removeCard.test.ts`：三张卡，光标在中间卡，`removeCard()` 后剩两张且中间那张没了；只剩一张时 `removeCard()` 返回 false、仍一张。
  失败测试（组件）— `CardToBox.test.tsx`：编辑器两张卡 + store 一个盒；点第一张卡的 `[data-card-ctrl="tobox"]` 打开菜单、点该盒 → 断言：盒 cards +1（含被移卡的文字/threadId），编辑器剩一张卡。

- [ ] **Step 2: 跑 `npm test -- removeCard CardToBox`，确认 FAIL。**

- [ ] **Step 3: 实现** ——
  `schema.ts` `removeCard`：找 cardDepth；`if (state.doc.childCount <= 1) return false`；`const pos=$from.before(cardDepth); const node=$from.node(cardDepth); dispatch(state.tr.delete(pos, pos+node.nodeSize))`。
  `CardView.tsx`：加"⇢"按钮 + 一个类似线菜单的盒子菜单；选盒执行：`const pos=getPos(); const json = editor.state.doc.nodeAt(pos)?.toJSON(); parkCard(boxId, json); editor.chain().focus().setTextSelection(pos+2).removeCard().run()`（先读 JSON 再删）。"＋新盒子" = `addBox` 后用其 id。

- [ ] **Step 4: 跑 `npm test -- removeCard CardToBox`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: park card into box (remove from river)"`

---

### Task 5: InDesign 式装载光标置入正文（盒子 → 正文）

**Files:** Modify `src/state/bookStore.ts`（加 `carried` 状态）, `src/ui/BoxView.tsx`（插入按钮接线）, `src/editor/RiverEditor.tsx`（装载横幅 + 落点插入）, `src/editor/schema.ts`（加 `insertCardJSONAfter` 命令）, `src/styles.css`; Test `src/editor/insertCardJSON.test.ts`, `src/ui/carry.test.tsx`

**Interfaces:**
- Produces:
  - store: `carried: { boxId: string; card: any } | null`；`carry(boxId, cardId)`（= `takeCardFromBox` 拿到卡、设 `carried`、并 `openChapter(activeChapterId)` 切回上次的章）；`dropCarried(): void`（清空，卡已被 take 走——见下"取消"说明）；`cancelCarry()`（把 carried 的卡放回原盒、清空）。
  - editor 命令 `insertCardJSONAfter(cardJSON, pos)` —— 在给定卡位置之后插入一张由 JSON 构造的卡（`state.schema.nodeFromJSON`），新卡的 cardId 置 null 交给 assignCardIds 重新分配（避免与别处 id 撞）。
  - RiverEditor：当 `carried` 非空，顶部显一条横幅「带着一张卡——点正文某处落定 · Esc 取消」；点某张卡 → `insertCardJSONAfter(carried.card, 该卡pos)` 成功后 `dropCarried()`。Esc → `cancelCarry()`。
  - BoxView 的"⤵ 插入正文"按钮 → `carry(boxId, cardId)`。

- [ ] **Step 1: 失败测试（命令）** — `insertCardJSON.test.ts`：两张卡 c0/c1，`insertCardJSONAfter(someCardJSON, c0的pos)` 后三张、新卡在中间、文字来自 JSON、新卡 cardId 非空且不等于 JSON 原 id。
  失败测试（流程）— `carry.test.tsx`：store 里一个盒含一张卡；`carry(boxId, cardId)` 后 `carried` 非空且盒里少一张、`viewKind==='chapter'`；`cancelCarry()` 后盒里恢复该卡、`carried` 为空。

- [ ] **Step 2: 跑 `npm test -- insertCardJSON carry`，确认 FAIL。**

- [ ] **Step 3: 实现** ——
  `schema.ts` `insertCardJSONAfter(cardJSON, pos)`：`const node = state.schema.nodeFromJSON({ ...cardJSON, attrs: { ...cardJSON.attrs, cardId: null } }); const after = pos + state.doc.nodeAt(pos)!.nodeSize;` 实际用传入 pos 定位卡末——为稳，命令签名取"某卡起点 pos"，`const cardNode = state.doc.nodeAt(pos); const after = pos + cardNode.nodeSize; tr.insert(after, node); setSelection(after+2)`。`declare module` 补。
  `bookStore.ts`：`carried` + `carry`/`cancelCarry`/`dropCarried`。`carry` 里调 `takeCardFromBox` 拿卡、记 `{boxId,card}`、`openChapter(get().activeChapterId)`。`cancelCarry`：`parkCard(carried.boxId, carried.card)` 放回、清空。`dropCarried`：仅清空（卡已进正文）。
  `RiverEditor.tsx`：读 `carried`；非空时渲染横幅；给编辑器 DOM 挂 click 监听：命中某 `.card` → 用 `editor.view.posAtDOM` 求该卡起点 pos → `editor.chain().focus().insertCardJSONAfter(carried.card, pos).run()` → `dropCarried()`。`Esc` keydown → `cancelCarry()`。
  BoxView 插入按钮 onClick → `carry(boxId, cardId)`。

- [ ] **Step 4: 跑 `npm test -- insertCardJSON carry`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 浏览器手动验证** —— `npm run dev` + Playwright：把一张正文卡"⇢"收进盒子 → 盒里出现；开盒 → 点"⤵ 插入正文" → 自动回到章、顶部横幅出现 → 点河里某卡 → 卡落在其后、盒里那张消失。截图。**提交** `git commit -m "feat: InDesign-style loaded-cursor insert from box into river"`

---

## Phase 4 完成后
左栏有了"章 + 盒子"两组；能建盒子、把正文卡收进盒子、开盒子看缩略图、用装载光标把盒中卡置入正文。**"现在不用、以后可能捡回来"的卡，终于有家、能回流了。**

## Self-Review
- 覆盖 spec 第 4 节（左栏盒子组）+ 第 6 节（盒子↔正文双向、装载光标置入、移动非复制）：Task 1（数据/导航）+ Task 2（左栏）+ Task 3（BoxView）+ Task 4（收纳）+ Task 5（置入）。
- 翻页式盒子视图、⠿ 拖卡进盒子（改用"⇢"按钮菜单）列为后续 polish，不阻塞。
- 占位符：无 TBD；ProseMirror 位置/JSON 构造注明以测试为准，测试有确切断言。
- 类型一致：`Box`、`boxes`、`viewKind`、`activeBoxId`、`addBox`/`openBox`/`openChapter`/`parkCard`/`takeCardFromBox`/`getBox`/`carry`/`cancelCarry`/`dropCarried`、命令 `removeCard`/`insertCardJSONAfter`、`data-card-ctrl="tobox"`、`data-box-action="insert"` 跨任务一致。
