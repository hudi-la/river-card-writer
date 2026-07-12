# Phase 14 · 目录记号/统色/预览 + 详细悬浮窗 + 多个通用盒子

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用户 7 条（见下）落地：目录折叠记号、目录/正文色块统一、正文预览"前N字+…"、详细视图改成悬浮大窗、通用盒子改多个可命名且用悬浮大窗打开、书柜能加新书/加新通用盒子。

**用户 7 条 → 任务映射：**
1 折叠记号 →T1；2 目录行用正文卡片色 →T1；4 正文块预览=能放下的前N字+"…" →T1；3 侧栏只留简略+"详细/排列"按钮开悬浮大窗（详细版在里面，可拖排）→T2；7 通用盒子改成"多个、可命名"（数据+同步+迁移）→T3；5/6 书内、书柜进通用盒子都用悬浮大窗 + 书柜加新书/加新通用盒子 →T4。

**Architecture:** 一个可复用的 `Modal`（悬浮大窗）组件，详细目录视图和通用盒子视图都塞进去。通用盒子从"单个 `library.universalBox`"改成"多个 `library.universalBoxes: Box[]`"（迁移：老的单个包成数组第一项；老 `cw_universal` 单 box → 数组）。色块统一：目录行读该行 card 的 color（或 autoCardColor(cardId)）当浅底色，和正文一致。遵守[[card-writer-never-lose-books]]。

**Tech Stack:** 沿用（React 19, TipTap v3, Zustand, Vitest, @supabase/supabase-js）。

## Global Constraints
- 数据安全：通用盒子改多个=数据结构变，必须迁移（老单 box 不丢）+ 迁移单测。
- 悬浮大窗 = 一个通用 Modal（遮罩 + 居中大面板 + Esc/点遮罩关 + 标题 + 关闭按钮）。
- 详细视图从侧栏移走：侧栏只剩简略树 + 一个"详细/排列"按钮。
- TDD：数据/迁移/命令先写失败测试；Modal、色块、预览、悬浮窗内交互靠浏览器验证。构建保持绿。

---

### Task 1: 目录小改 —— 折叠记号 + 统色 + 预览前N字+省略号

**Files:** Modify `src/ui/LeftNav.tsx`, `src/styles.css`; Test `src/ui/LeftNav.test.tsx`

- **#1 折叠记号**：collapsed 的标题行除了 ▸，再加个明显小记号（如标题后一个淡"…"或行加一层淡背景/点），一眼看出"这里折叠了有内容"。展开的不加。
- **#2 统色**：每个目录行（标题行、块行）加一层浅底色 = 该行对应 card 的颜色（有 color 用 color、否则 `autoCardColor(cardId)`），透明度和正文卡片色带一致，让目录和正文看起来是一套。
- **#4 预览**：块行没写说明时，预览= card 纯文本的**前 N 字 + "…"**（N 取"该行框宽能放下的字数"——可用 CSS 单行截断 `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` 让浏览器自动按宽度截断加省略号，而不是固定 14 字）。标题行不变（显示标题；有说明显示说明）。

- [ ] Step 1: 失败测试（`LeftNav.test.tsx`）：collapsed 标题行带折叠记号 class/标记；目录行带背景色（data-color 或 style var）；块行预览用单行省略容器（断言其 class/style 含省略截断）。
- [ ] Step 2: 跑 `npm test -- LeftNav` 确认 FAIL。
- [ ] Step 3: 实现（记号 + 行底色读 card color + 预览改单行 CSS 截断）。
- [ ] Step 4: 全量 `npm test` + `npm run build`。
- [ ] Step 5: 浏览器验证（截图仅绝对路径 `card-writer/.superpowers/sdd/screenshots/`）：折叠项有记号、目录行底色和正文一致、长正文块预览按宽度截断加…。提交 `git commit -m "feat: outline collapse marker + card-color rows + width-fit preview ellipsis"`

---

### Task 2: 详细视图 → 悬浮大窗（侧栏只留简略）

**Files:** Create `src/ui/Modal.tsx`, `src/ui/OutlineDetail.tsx`; Modify `src/ui/LeftNav.tsx`, `src/styles.css`; Test `src/ui/Modal.test.tsx`, `src/ui/OutlineDetail.test.tsx`

- `Modal`：遮罩 + 居中大面板（宽如 min(920px,92vw)、高 min(80vh)）、标题、关闭按钮、Esc/点遮罩关闭、内容可滚。可复用。
- 侧栏 LeftNav：**删掉简略/详细切换**，只渲染简略树；加一个按钮"详细"/"排列大纲"（放目录组顶部），点击开 Modal，里面渲染 `OutlineDetail`。
- `OutlineDetail`（大窗内）：把原详细视图搬进来——每行标题/块 + 可编辑说明框，且支持**拖动重排**（复用已有目录拖拽/moveSection/moveCardTo），方便排大框架。宽敞布局。

- [ ] Step 1: 失败测试：`Modal.test.tsx`（open 渲染内容、Esc/遮罩点击调 onClose）；`OutlineDetail.test.tsx`（渲染各行 + 说明框，编辑调 setHeadingNote/setCardNote）；LeftNav 测试改为断言"无详细 toggle、有详细按钮点击 opens modal"。
- [ ] Step 2: 跑测试确认 FAIL。
- [ ] Step 3: 实现。
- [ ] Step 4: 全量 `npm test` + `npm run build`。
- [ ] Step 5: 浏览器验证：侧栏只简略；点"详细"开大窗、里面详细可编辑说明可拖排；Esc/点外关。提交 `git commit -m "feat: detailed outline in a floating modal; sidebar keeps only the brief tree"`

---

### Task 3: 通用盒子改"多个、可命名" —— 数据 + 迁移 + 同步

**Files:** Modify `src/state/bookStore.ts`, `src/state/sync.ts`; Test `src/state/bookStore.test.ts`, `src/state/sync.test.ts`

- `library.universalBoxes: Box[]`（替代单个 `universalBox`）。保留 `UNIVERSAL_BOX_ID` 兼容或改为每个有自己 id（`u_` 前缀）。默认一个"通用盒子"。
- 动作：`addUniversalBox(name)`、`renameUniversalBox(id,name)`、（可选 delete）。盒子操作 getBox/parkCard/takeCardFromBox/carry 的"命中通用"分派改为"在 universalBoxes 里按 id 找"。
- `normalizeLibrary` 迁移：老 `universalBox`（单个）→ `universalBoxes:[该box]`；无 → `[默认一个]`。
- 同步（`cw_universal` 表，一人一行，data jsonb）：data 改存 `universalBoxes` 数组；`rowToUniversal`/`universalToRow`/合并按"每个 box 按 id、cards 按 cardId union"非破坏式合并；老 data（单 box）读入时包成数组。

- [ ] Step 1: 失败测试：初始 `universalBoxes` 有一个默认；`addUniversalBox('灵感')` +1；`renameUniversalBox`；park/take 按 id 命中对应通用盒；跨书共享；`normalizeLibrary` 老单 box → 数组且不丢卡；sync 合并多盒非破坏。
- [ ] Step 2: 跑 `npm test -- bookStore sync` 确认 FAIL。
- [ ] Step 3: 实现（UI 引用 `universalBox` 的地方会红——列出留 T4）。
- [ ] Step 4: bookStore/sync 测试绿；全量红项记录待 T4。
- [ ] Step 5: 提交 `git commit -m "feat: multiple named universal boxes (data + migration + sync)"`

---

### Task 4: 通用盒子 UI —— 悬浮大窗打开 + 书柜加新书/加新通用盒子/改名

**Files:** Modify `src/ui/Bookshelf.tsx`, `src/ui/LeftNav.tsx`, `src/App.tsx`, `src/ui/BoxView.tsx`; Test `src/ui/Bookshelf.test.tsx`, `src/ui/LeftNav.test.tsx`

- **#5/#6 悬浮大窗**：书内点某通用盒子、书柜点某通用盒子，都用 `Modal` 打开 `BoxView`（去掉 shell==='universal' 全屏，改成 Modal）。书内的窗里插入按钮可用（有当前 doc）；书柜的窗里插入按钮禁用（无 doc）。
- **#7 书柜**：`＋ 新书` 挪到书卡旁（去掉底部那个）；加 `＋ 新通用盒子`（`addUniversalBox`）；通用盒子入口列出所有 universalBoxes，每个可**双击改名**（`renameUniversalBox`），点击开 Modal。
- **LeftNav**：底部通用盒子组列出所有 universalBoxes（各自可展开列卡、data-box-id 供拖入），点击开 Modal。
- 恢复因 T3 改数据结构而红的所有引用，全量绿。

- [ ] Step 1: 失败测试：Bookshelf 渲染 ＋新书(书旁)+＋新通用盒子+通用盒子列表(可改名)；点通用盒子 opens Modal；LeftNav 通用盒子组列出多个。
- [ ] Step 2: 跑测试确认 FAIL。
- [ ] Step 3: 实现（含 App 去掉 universal 全屏、改 Modal）。
- [ ] Step 4: 全量 `npm test` + `npm run build`（全绿）。
- [ ] Step 5: 浏览器验证：书柜加新书/加新通用盒子/改名；书内、书柜点通用盒子都开悬浮大窗；拖卡进通用盒子仍可；跨书共享；刷新持久。提交 `git commit -m "feat: universal boxes open in a modal; shelf adds books & universal boxes & renames"`

---

## Self-Review
- 覆盖 7 条：#1/#2/#4→T1；#3→T2；#7 数据→T3、#7 UI+#5/#6→T4。
- 数据安全：通用盒子多个化配迁移+单测；色块/预览/记号纯视图。
- 类型一致：`universalBoxes`、`addUniversalBox`/`renameUniversalBox`、`Modal`、`OutlineDetail`、色块 data-color、cw_universal data=数组 跨任务一致。
