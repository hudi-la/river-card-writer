# Phase 10 · 目录固定 + 章节说明便签 + 两视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 改左栏「目录」：① 固定在左、不随正文滚、超屏自身独立滚；② 每个章/节标题可挂一段可编辑的"梗概/说明"便签，简略视图 hover 浮出、可看可改；③ 目录两种视图：简略 / 详细（详细=每条直接把说明铺出来，像缩略图）。

**Architecture:** 说明存成**标题段落节点的 `note` 属性**（默认 ''），跟随 `book.doc` 持久化（localStorage + 云 + 备份都自动带上）——**新增字段、默认空、零迁移风险，绝不动老内容**（遵守[[card-writer-never-lose-books]]铁律）。侧栏在 doc 视图下编辑说明时，通过一个**editor 桥**（一个小 store 存 RiverEditor 挂上来的 editor 实例）调用编辑器命令 `setHeadingNote(headingIndex, note)`，保持"编辑器是 doc 唯一真源"。`outlineFromDoc` 顺带返回每条的 note。CSS 让 `.rail` 固定 + 独立滚。

**Tech Stack:** 沿用（React 19, TipTap v3, ProseMirror, Zustand, Vitest）。

## Global Constraints
- 段落 `note` 属性：string，默认 ''，仅存储/元数据，**不在正文里显示文字**（渲染成 `data-note` 隐藏属性即可，getJSON 自然带上）。
- 命令 `setHeadingNote(headingIndex: number, note: string)`：定位到文档里第 `headingIndex` 个 `style∈{chapter,h1}` 的段落，设其 `note`。
- `outlineFromDoc(doc)` 每条加 `note: string`（读该标题段落的 note attr）。
- 数据安全：新属性默认空；老文档解析后该属性=''，正文不受影响；无需迁移。
- editor 桥：一个 `useEditorBridge`/store，RiverEditor mount 时 `setEditor(editor)`、unmount 时 `setEditor(null)`；LeftNav 用它调 `setHeadingNote`。
- 不碰存储格式的其它部分、不碰云同步逻辑。
- TDD：命令 + outline + note 默认值先写失败测试；侧栏固定/hover 便签/两视图靠浏览器验证。构建保持绿。

---

### Task 1: 段落 note 属性 + setHeadingNote 命令 + outline 带 note + editor 桥

**Files:** Modify `src/editor/schema.ts`（Paragraph 加 note attr + 命令）, `src/ui/LeftNav.tsx`（outlineFromDoc 加 note）; Create `src/state/editorBridge.ts`; Modify `src/editor/RiverEditor.tsx`（注册 editor）; Test `src/editor/headingNote.test.ts`, 更新 outline 测试

**Interfaces:**
- Paragraph 扩展加 `note`（default ''，parseHTML `data-note`，renderHTML 有值时输出 `data-note`）。
- 命令 `setHeadingNote(headingIndex, note)`（加入 declare-module）。
- `outlineFromDoc(doc): { level:1|2, text:string, index:number, note:string }[]`。
- `editorBridge`（Zustand）：`editor: Editor|null`、`setEditor(e)`；派生便捷 `setHeadingNote(index, note)`（editor 存在才调 `editor.commands.setHeadingNote`）。RiverEditor 在 useEditor 后 useEffect 注册/注销。

- [ ] **Step 1: 失败测试** —— `headingNote.test.ts`：构造含两个 chapter 标题的 doc，`setHeadingNote(1, '第二章的说明')` 后第 2 个标题段 `attrs.note==='第二章的说明'`、第 1 个仍 ''；`outlineFromDoc` 返回两条且 note 分别为 '' 和 '第二章的说明'；老段落（无 note）默认 ''。

- [ ] **Step 2: 跑 `npm test -- headingNote LeftNav`，确认 FAIL。**

- [ ] **Step 3: 实现** —— Paragraph 加 note attr；命令遍历定位第 index 个 chapter/h1 段用 `setNodeMarkup`/`setNodeAttribute` 设 note；`outlineFromDoc` 读 note；`editorBridge` store；RiverEditor 注册 editor。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: per-heading note attr + setHeadingNote + outline note + editor bridge"`

---

### Task 2: 左栏固定滚动 + hover 便签 + 简略/详细两视图

**Files:** Modify `src/ui/LeftNav.tsx`, `src/styles.css`, `src/state/prefsStore.ts`（存视图选择，可选）; Test `src/ui/LeftNav.test.tsx`（扩充能测的部分）

**Interfaces:**
- **固定滚动**：`.rail { position: sticky; top:0; align-self:start; height:100vh; overflow-y:auto; }`（或等效方案）——目录固定、超屏自身滚，正文照常滚。验证正文长时目录不跟着跑。
- **视图切换**：目录顶部一个小切换（简略 / 详细），状态存 `prefsStore`（`outlineView:'brief'|'detail'`，持久化）或本地。
- **简略视图**：每条 outline 项照旧；**hover 该项 → 旁边浮出一个可编辑便签**（`<textarea>` 显示该条 note，改动 onBlur/防抖调 `editorBridge.setHeadingNote(index, value)`）。浮层 `contentEditable` 无关、绝对定位在该项右侧。
- **详细视图**：每条 outline 项渲染成一张小卡，**直接把 note 文本铺出来**（也可编辑，textarea），像缩略图；标题在上、说明在下。
- 盒子组不受影响。

- [ ] **Step 1: 失败测试** —— `LeftNav.test.tsx`：详细视图下渲染出每条的 note 文本框；切换按钮能在 brief/detail 间切；给某条编辑 note 会调用 editorBridge.setHeadingNote（可 mock bridge）。（hover 浮层定位/固定滚动靠浏览器验证。）

- [ ] **Step 2: 跑 `npm test -- LeftNav`，确认 FAIL。**

- [ ] **Step 3: 实现** —— LeftNav 加视图切换 + 两视图渲染 + hover 便签 + 编辑接 editorBridge；CSS 固定滚动 + 便签浮层 + 详细卡片样式（克制好看）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证（截图仅存绝对路径 `card-writer/.superpowers/sdd/screenshots/`）** —— 正文很长时目录固定不跑、目录超屏自身滚；hover 章节名浮出便签、输入后切走再回来还在（且刷新还在=进了 doc）；切详细视图每条铺出说明；简略/详细切换持久。**提交** `git commit -m "feat: fixed scrollable outline + hover note pad + brief/detail views"`

---

## Phase 10 完成后
左栏目录钉在左边、超屏自身滚；每章/节能写"梗概/说明"，简略视图 hover 浮出便签可编辑，详细视图直接铺开；说明跟着书走（本地+云+备份都带）。

## Self-Review
- 覆盖用户三点：Task 2（固定滚动 + 两视图 + hover 便签）+ Task 1（说明数据 + 编辑通道）。
- 数据安全：note 为新增默认空属性、零迁移、不动老正文；说明随 doc 持久化/同步/备份。
- 占位符：无 TBD；hover/固定/浮层注明浏览器验证，命令/outline 给确切断言。
- 类型一致：Paragraph `note`、`setHeadingNote`、`outlineFromDoc().note`、`editorBridge`、`outlineView` 跨任务一致。
