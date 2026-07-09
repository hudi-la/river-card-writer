# Phase 5 · 语义样式 + 全局阅读开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 一小套**讲究、好看**的语义段落样式（正文 / 小标题 / 引文 / 旁注）——标的是"这段是什么角色"，工具用统一排版渲染；再加一个**全局阅读偏好**（衬线/无衬线、字号、行宽），随时改、统一作用。**不做**逐段自由改字体字号。

**Architecture:** 语义角色复用 card 节点已有的 `role` 属性（'body'|'heading'|'quote'|'note'）。`CardView` 把 `role` 落到 `data-role`，CSS 按角色给出讲究的排版。控制簇加一个"样式"入口选角色。全局阅读偏好存 store 的 `prefs` slice（持久化到 localStorage 独立 key），由一个设置面板改；应用方式 = 在根元素上写 CSS 变量（`--reading-font`/`--reading-size`/`--reading-measure`），`.river` 全部引用这些变量。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。

## Global Constraints
- 角色固定四种：`body`（正文）、`heading`（小标题）、`quote`（引文）、`note`（旁注）。名字与 card `role` 属性一致。
- 不做逐段自由字体/字号（那是导出，未来）。全局偏好是**全局统一**、不耦合内容。
- `prefs = { font: 'serif' | 'sans'; size: number /*px*/; measure: number /*em 或 px 的正文列宽*/ }`，独立持久化 key `card-writer:prefs`，有默认值。
- 角色随卡片 JSON 走（收进盒子/置入都带着 role）。颜色（threadId）与角色（role）互不干扰、可叠加。
- 不引入 Supabase（Phase 6）。
- TDD：命令、store slice 先写失败测试；纯视图（角色菜单、设置面板）组件测试 + 浏览器手动验证。

---

### Task 1: setCardRole 命令 + 四种角色的讲究排版

**Files:** Modify `src/editor/schema.ts`（加 `setCardRole` 命令）, `src/editor/CardView.tsx`（`data-role` 落到 wrapper）, `src/styles.css`; Test `src/editor/setCardRole.test.ts`, `src/editor/CardView.test.tsx`（扩充）

**Interfaces:**
- Produces:
  - 命令 `setCardRole(role: 'body'|'heading'|'quote'|'note')` —— 设光标所在 card 的 `role` 属性。加入 `declare module` card 接口。
  - CardView 的 `NodeViewWrapper` 加 `data-role={role}`。
  - CSS：`.card[data-role="heading"] .card-body p`（更大、字重、上下留白、无首行缩进）、`[data-role="quote"]`（左内缩 + 左竖线或斜体、稍灰）、`[data-role="note"]`（小一号、灰、无缩进）、`[data-role="body"]`（现有正文排版）。要**好看、克制**。

- [ ] **Step 1: 失败测试** — `setCardRole.test.ts`：一张卡，`setCardRole('heading')` 后该卡 `attrs.role==='heading'`；再 `setCardRole('body')` 回到 body。`CardView.test.tsx` 追加：注入一张 `role:'heading'` 的卡，断言渲染出的 `section.card` 带 `data-role="heading"`。

- [ ] **Step 2: 跑 `npm test -- setCardRole CardView`，确认 FAIL。**

- [ ] **Step 3: 实现** —— `schema.ts` `setCardRole`（模式同 `setCardThread`，`setNodeAttribute(pos,'role',role)`），补 declare-module。`CardView.tsx`：`const role = props.node.attrs.role || 'body'`，`<NodeViewWrapper ... data-role={role}>`。`styles.css` 写四种角色排版（heading：`font-size:1.25em; font-weight:700; text-indent:0; margin:.4em 0`；quote：`padding-left:1.5em; border-left:2px solid var(--faint); color:#6a6258; font-style:italic; text-indent:0`；note：`font-size:.85em; color:var(--muted); text-indent:0`；body 维持现状）。选择器作用到 `.card[data-role="X"] .card-body p`。

- [ ] **Step 4: 跑 `npm test -- setCardRole CardView`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: setCardRole command + semantic role typography"`

---

### Task 2: 角色选择 UI（控制簇里的"样式"入口）

**Files:** Modify `src/editor/CardView.tsx`, `src/styles.css`; Test `src/editor/CardRoleMenu.test.tsx`

**Interfaces:**
- Consumes: 命令 `setCardRole`、`getPos`。
- Produces: 控制簇加 `data-card-ctrl="role"` 的按钮（图标如"¶"或"Aa"），点开小菜单：正文 / 小标题 / 引文 / 旁注，四项，点=`chain().focus().setTextSelection(getPos()+2).setCardRole(x).run()`，当前角色高亮。

- [ ] **Step 1: 失败测试** — `CardRoleMenu.test.tsx`：一张卡，点 `[data-card-ctrl="role"]` 开菜单，点"小标题" → 断言该卡 JSON `role==='heading'`。

- [ ] **Step 2: 跑 `npm test -- CardRoleMenu`，确认 FAIL。**

- [ ] **Step 3: 实现** —— 复用线菜单/盒子菜单的受控 `useState` 菜单模式，四个固定项（label→role 映射）。`onMouseDown`+`preventDefault`，选后关。当前 `props.node.attrs.role` 高亮。CSS 复用 `.thread-menu` 风格或加 `.role-menu`。

- [ ] **Step 4: 跑 `npm test -- CardRoleMenu`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: per-card role picker menu"`

---

### Task 3: 全局阅读偏好（store slice + 设置面板）

**Files:** Create `src/state/prefsStore.ts`, `src/ui/ReadingSettings.tsx`; Modify `src/ui/Workspace.tsx`, `src/styles.css`; Test `src/state/prefsStore.test.ts`, `src/ui/ReadingSettings.test.tsx`

**Interfaces:**
- Produces:
  - `usePrefsStore`（Zustand）：state `prefs: { font:'serif'|'sans'; size:number; measure:number }`；actions `setFont`/`setSize`/`setMeasure`；默认 `{ font:'serif', size:15, measure:680 }`；持久化到 `localStorage['card-writer:prefs']`，init 时读取。
  - `ReadingSettings()` —— 一个齿轮按钮（右上角）打开的小面板：衬线/无衬线切换、字号 slider（如 13–20）、行宽 slider（如 560–820）。改动即时生效。
  - 应用方式：`Workspace`（或一个 effect）把 prefs 写成根元素的 CSS 变量 `--reading-font`/`--reading-size`/`--reading-measure`；`styles.css` 里 `.river .card-body p{ font-family: var(--reading-font); font-size: var(--reading-size); }` 与 `.river-wrap{ width: var(--reading-measure); }`（保留 role 特有的相对调整用 `em`，使其随全局字号缩放）。

- [ ] **Step 1: 失败测试** — `prefsStore.test.ts`：默认值正确；`setFont('sans')`/`setSize(18)`/`setMeasure(720)` 改并持久化到 `card-writer:prefs`。`ReadingSettings.test.tsx`：渲染面板，点"无衬线"→ `usePrefsStore.getState().prefs.font==='sans'`；拖字号（fireEvent.change slider）→ size 更新。

- [ ] **Step 2: 跑 `npm test -- prefsStore ReadingSettings`，确认 FAIL。**

- [ ] **Step 3: 实现** —— `prefsStore.ts`（独立于 bookStore，同样的 persist 模式，key `card-writer:prefs`，含 `__resetForTest`）。`ReadingSettings.tsx`（齿轮 + 面板，衬线/无衬线两个按钮 + 两个 `<input type=range>`）。`Workspace.tsx` 里 `useEffect` 依 prefs 设 `document.documentElement.style.setProperty('--reading-font', prefs.font==='serif' ? "Georgia,'Songti SC',serif" : "system-ui,'PingFang SC',sans-serif")` 等三个变量，并渲染 `<ReadingSettings/>`。`styles.css` 把 `.card-body p` 的 font-family/font-size 和 `.river-wrap` 宽度改成引用变量（body 角色用 `var(--reading-size)`，heading/quote/note 用 `em` 相对之）。

- [ ] **Step 4: 跑 `npm test -- prefsStore ReadingSettings`，全量 `npm test`，`npm run build`。**

- [ ] **Step 5: 浏览器手动验证** —— `npm run dev` + Playwright：开设置 → 切无衬线（正文变无衬线）、加大字号（正文变大、小标题按比例变大）、改行宽（列变窄/宽）；给某卡设"小标题""引文""旁注"看排版差异；刷新后偏好还在。截图。**提交** `git commit -m "feat: global reading preferences panel"`

---

## Phase 5 完成后
每张卡可设"正文/小标题/引文/旁注"，各有讲究排版；右上角设置能全局切衬线/无衬线、调字号与行宽，统一作用、刷新不丢。**内容的"角色"和阅读的"舒适度"都能调了，但没有把逐段排版这个拖延面放进来。**

## Self-Review
- 覆盖 spec 第 7 节（语义样式一小套 + 全局阅读开关；不做逐段排版）：Task 1（角色渲染）+ Task 2（选角色 UI）+ Task 3（全局偏好）。
- 占位符：无 TBD；CSS 具体值给了，注明"好看/克制"，测试断言 role 属性/data-role/prefs 状态。
- 类型一致：`setCardRole`、`data-role`、`data-card-ctrl="role"`、`usePrefsStore`/`prefs`/`setFont`/`setSize`/`setMeasure`、CSS 变量 `--reading-*` 跨任务一致。
