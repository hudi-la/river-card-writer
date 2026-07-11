# Phase 13 · 章节折叠（目录 + 正文一起收起）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 每个章/节标题旁一个小三角 ▾/▸。点它折叠该标题：**目录**里它底下的块/子节收起，**正文**里该段（标题之后、下一个同级或更高级标题之前的所有卡片）一起 `display:none` 隐藏，只留标题。再点展开。

**Architecture:** 折叠状态存 heading 段落的新属性 `collapsed`（bool, default false，随 doc 持久化/同步/备份；遵守[[card-writer-never-lose-books]]——新增默认属性、不动正文）。纯函数 `hiddenCardIndices(doc): Set<number>` 算出"处于折叠段内、应隐藏的 card 下标"（heading 卡本身不隐藏）。编辑器用一个 ProseMirror 装饰插件给这些 card 打隐藏 class（CSS `display:none`）。目录（`outlineTreeFromDoc`/LeftNav）读 heading 的 collapsed，折叠时不渲染其后代行、并给标题行画三角。命令 `toggleCollapsed(headingCardIndex)`。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。

## Global Constraints
- `collapsed` 只加在 heading 段（style∈chapter/h1/h2）上，default false；非折叠时行为完全不变。
- 折叠段范围：从该 heading 卡之后，到"下一个 level ≤ 当前 heading level 的 heading 卡"之前（不含）——与 `moveSection` 的段定义一致，复用同一段边界逻辑。
- 折叠影响两处、且同源（都读同一个 `collapsed`）：目录隐藏后代行；正文隐藏段内 card。heading 卡两处都仍可见。
- 三角点击与拖动重排/点击滚动分开（chevron 自己的小热区 + stopPropagation）。
- 不碰存储/同步其它部分。
- TDD：命令、`hiddenCardIndices`、段边界先写失败测试；三角 UI + 正文隐藏靠浏览器验证。构建保持绿。

---

### Task 1: heading `collapsed` 属性 + toggle 命令 + 正文隐藏装饰

**Files:** Modify `src/editor/schema.ts`（paragraph collapsed 属性 + 命令 + 段边界 helper + 装饰插件）, `src/styles.css`; Test `src/editor/collapse.test.ts`

**Interfaces:**
- paragraph 加 `collapsed`（bool, default false, parse/render `data-collapsed`；仅 heading 用）。
- 命令 `toggleCollapsed(headingCardIndex: number)`：翻转该 heading 卡里 heading 段的 collapsed。加入 declare-module。
- 导出纯函数 `sectionRange(doc, headingCardIndex): [startExclusive, endExclusive]` 或等价，和 `hiddenCardIndices(doc): Set<number>`（遍历所有 collapsed heading，收集其段内 card 下标；heading 卡自身不含）。
- ProseMirror 装饰插件（加进 baseExtensions 或 Card 的 addProseMirrorPlugins）：用 `hiddenCardIndices(state.doc)` 给这些 card 打 `card-collapsed-hidden` node 装饰 class。CSS `.card-collapsed-hidden{display:none}`。heading 卡加个 `data-collapsed` 以便画折叠态样式（可选）。

- [ ] **Step 1: 失败测试** —— `collapse.test.ts`：doc=[章1, a, 节1.1, b, 章2, c]；`toggleCollapsed(章1 index)` 后章1 heading 段 collapsed=true；`hiddenCardIndices` 返回 {a, 节1.1, b 的下标}（章1 段一直到章2 之前，含子节 b），不含章1、章2、c；`toggleCollapsed(节1.1 index)`（单独测）只隐藏 b。默认无 collapsed 时 hiddenCardIndices 为空（向后兼容）。

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现。**

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: heading collapsed attr + toggle + hide collapsed-section cards in editor"`

---

### Task 2: 目录三角 + 折叠隐藏后代行

**Files:** Modify `src/ui/LeftNav.tsx`, `src/styles.css`, `src/state/editorBridge.ts`（加 toggleCollapsed 便捷）; Test `src/ui/LeftNav.test.tsx`

**Interfaces:**
- `outlineTreeFromDoc` 行结构加 `collapsed?: boolean`（heading 行读其 collapsed）——或 LeftNav 自行从 doc 读。
- LeftNav：每个 heading 行左侧一个 ▾/▸ **三角**（有后代才显示可点；collapsed 时 ▸）。点三角 → `editorBridge.toggleCollapsed(cardIndex)`，stopPropagation（不触发滚动/拖动）。
- 渲染时：某 heading collapsed → **跳过渲染它的后代行**（块 + 子标题，直到段结束）。
- 三角与拖动重排、点击滚动共存（三角独立热区）。

- [ ] **Step 1: 失败测试** —— `LeftNav.test.tsx`：含"章+两块+一节+一块"的 doc；章行有三角；点章的三角调 `editorBridge.toggleCollapsed(章cardIndex)`；当章 collapsed=true 时，目录不渲染其后代行（只剩章行本身，后面若有同级章才继续）。

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现。**

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证（截图仅绝对路径 `card-writer/.superpowers/sdd/screenshots/`）** —— 点章三角 → 目录该章后代收起（▸）且**正文该章内容一起隐藏、只留标题**；再点展开恢复；折叠态刷新后还在；三角不影响拖动/滚动。**提交** `git commit -m "feat: outline collapse triangle folds outline subtree + body together"`

---

## Phase 13 完成后
章/节可折叠：一个三角同时收起目录后代行和正文段内容，只留标题；再点展开；状态随书持久化。

## Self-Review
- 覆盖诉求：三角折叠、目录+正文一起收、章/节层级。
- 数据安全：collapsed 新增默认 false、不动正文；隐藏只是 display:none 装饰，不删内容。
- 占位符：无 TBD；三角/正文隐藏注明浏览器验证，命令/段边界/hiddenCardIndices 给确切断言。
- 类型一致：paragraph `collapsed`、`toggleCollapsed`、`hiddenCardIndices`/`sectionRange`、装饰 class `card-collapsed-hidden`、`editorBridge.toggleCollapsed` 跨任务一致。段边界逻辑与 `moveSection` 复用同一定义。
