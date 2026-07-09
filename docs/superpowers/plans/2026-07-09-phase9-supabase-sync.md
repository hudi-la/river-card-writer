# Phase 9 · Supabase 登录 + 云同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让 card-writer 的书**存进云端**（reading assistant Supabase 的 `cw_books` 表，已建好、RLS 已开），邮箱 magic-link 登录，登录后书在云和本地之间同步；本地写的书首次登录时上传到云，从此不丢、可跨设备。

**Architecture:** 用 `@supabase/supabase-js`（已装 2.110.2）。`.env` 已有 `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`。一个 `supabase.ts` 单例 client。`authStore`（Zustand）持 session。未登录 → 显示 `SignIn`（输入邮箱→发 magic link→提示查收）；登录后 → 现有 app。`sync.ts` 负责 library ↔ `cw_books`：登录后拉云端书 hydrate 到 library store；library 变化时防抖 upsert；新增 insert、删除 delete。localStorage 继续当离线缓存。**首登迁移**：云端为空但本地有书 → 把本地书上传（不丢现有写作）。

**Tech Stack:** React 19, Vite, TipTap, Zustand, @supabase/supabase-js, Vitest.

## Global Constraints
- `cw_books` 列：`id uuid`、`owner uuid=auth.uid()`、`title text`、`data jsonb`（存 `{ doc, boxes }`）、`position int`、`updated_at`。RLS：只能读写 `owner=auth.uid()` 的行（已建好）。
- Book 与云行映射：`Book{id,title,doc,boxes}` ↔ 行 `{ id, title, data:{doc,boxes}, position }`。`Book.id` 用作行 `id`（uuid；现有本地 id 用 nanoid，不是 uuid——见迁移：首登上传时为每本生成新 uuid 或保留 nanoid 存进 id 需 id 列改 text。**决定：`cw_books.id` 保持 uuid，本地 nanoid 的书首登时映射到新 uuid，并把新 id 写回本地 library**，避免类型不一致）。
- 登录用 `supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin } })`。session 由 supabase-js 自动持久化（localStorage），登录一次长期有效。
- 离线/未登录也能用（纯本地），登录只是叠加云同步。
- 不改动 reading app 的表。
- TDD：能纯逻辑测的（映射函数、首登迁移决策、sync reducer）先写失败测试；auth UI / 真实网络往返靠浏览器验证 + 手动（magic link 需真邮箱）。构建保持绿。

## ⚠️ 需要用户在 Supabase 后台做的一次性设置（写进最终交付说明，不在代码里）
- Authentication → URL Configuration：把 **Site URL** 和 **Redirect URLs** 加上 `http://localhost:5173`（本地）以及将来的部署域名。否则 magic link 点开会被拒。

---

### Task 1: Supabase client + 邮箱 magic-link 登录闸门

**Files:** Create `src/lib/supabase.ts`, `src/state/authStore.ts`, `src/ui/SignIn.tsx`; Modify `src/App.tsx`, `src/styles.css`; Test `src/state/authStore.test.ts`（可测部分）, `src/ui/SignIn.test.tsx`

**Interfaces:**
- `supabase.ts`：`export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)`；若 env 缺失，导出 `supabase = null` 并 `export const cloudEnabled = !!(url && key)`（无 env 时纯本地，不崩）。
- `authStore`（Zustand）：`session: Session|null`、`status: 'loading'|'signed-in'|'signed-out'`；`init()`（`supabase.auth.getSession()` + `onAuthStateChange` 订阅）；`signInWithEmail(email): Promise<{sent:boolean,error?:string}>`（调 signInWithOtp）；`signOut()`。`cloudEnabled` 为 false 时 status 直接 'signed-out' 但 app 仍可用（本地模式）。
- `SignIn`：邮箱输入 + "发送登录链接"按钮；发送后显示"去邮箱点链接"。含一个"先本地用（不登录）"的入口 → 进 app 纯本地。
- `App`：`cloudEnabled && status==='signed-out'`（且用户未选本地模式）→ `<SignIn/>`；否则现有 app（书柜/编辑器）。`status==='loading'` 显极简加载态。

- [ ] **Step 1: 失败测试** —— `authStore.test.ts`：mock `supabase.auth`，测 `signInWithEmail` 调 `signInWithOtp` 且成功返回 `{sent:true}`、失败返回 error；`signOut` 调 `auth.signOut` 并置 signed-out。`SignIn.test.tsx`：输入邮箱点按钮 → 调 authStore.signInWithEmail、UI 变"查收邮箱"；点"先本地用"→ 回调进入本地模式。

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现** —— 按接口。authStore 用可注入的 supabase（测试传 mock）。SignIn 克制好看（复用 --paper/--hair）。App 加闸门 + 本地模式旁路（一个 `localOnly` 标志，存内存或 localStorage）。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 提交** `git commit -m "feat: supabase client + email magic-link auth gate (local-only fallback)"`

---

### Task 2: library ↔ cw_books 云同步（含首登迁移）

**Files:** Create `src/state/sync.ts`; Modify `src/state/bookStore.ts`（挂同步钩子）, `src/App.tsx`（登录后启动 sync）; Test `src/state/sync.test.ts`

**Interfaces:**
- 纯函数（可测）：
  - `rowToBook(row): Book` 与 `bookToRow(book, ownerId, position): Row`。
  - `firstSyncPlan(localBooks, cloudRows): { upload: Book[]; download: Book[]; idRemap: Record<string,string> }` —— 云空+本地有 → 全 upload（本地 nanoid → 新 uuid，记 idRemap）；云有 → download 覆盖为云端（本地作缓存）；两边都空 → 空。
- `startSync(store, supabase, ownerId)`：① 拉 `cw_books`（owner 自动受 RLS 限定）→ 执行 firstSyncPlan → 更新 library store（download 或 upload 后回填 uuid），并 persist；② 订阅 store 变化，防抖（~800ms）把改动 upsert 到 `cw_books`（按 book.id upsert data/title/position/updated_at）；③ `addBook`/`deleteBook` 对应 insert/delete。`cloudEnabled`/未登录时 `startSync` 不启动，纯本地。
- bookStore：暴露一个订阅入口或在 actions 里发出"书变了"事件供 sync 挂钩（最小侵入：sync 用 `useBookStore.subscribe`）。

- [ ] **Step 1: 失败测试** —— `sync.test.ts`：`rowToBook`/`bookToRow` 往返相等；`firstSyncPlan`：云空本地俩书 → upload 两本 + idRemap 有两条；云有一本 → download 一本、upload 空；都空 → 全空。（真实 supabase 往返 mock 掉或浏览器验证。）

- [ ] **Step 2: 跑测试确认 FAIL。**

- [ ] **Step 3: 实现** —— 纯函数 + `startSync`（用注入的 supabase client，测试可 mock query builder）。防抖 upsert。App 在 `status==='signed-in'` 时 `startSync(...)`，signOut 时停订阅。

- [ ] **Step 4: 全量 `npm test` + `npm run build`。**

- [ ] **Step 5: 浏览器手动验证（有限）** —— `npm run dev`：`cloudEnabled` 时未登录显示 SignIn（截图存**绝对路径** `card-writer/.superpowers/sdd/screenshots/`，或 MCP 拒绝就跳过截图）；"先本地用"能进 app。真实 magic-link 往返 + 云读写留给用户拿真邮箱测（交付说明里写清步骤）。**提交** `git commit -m "feat: library<->cw_books cloud sync with first-login migration"`

---

## Phase 9 完成后
打开 card-writer：可用邮箱登录（magic link），也可"先本地用"。登录后，本地已写的书首次上传到云，从此云端为准、跨设备可见、刷新/换机不丢；改动自动回存云端。无 env / 未登录时退回纯本地，不崩。

## 交付给用户的话（写进最后汇报）
1. 你要在 Supabase 后台 Authentication → URL Configuration 把 `http://localhost:5173` 加进 Site URL + Redirect URLs（否则登录链接点开被拒）。
2. 打开 app → 输邮箱 → 查收 Supabase 的登录邮件 → 点链接回到 app 即登录 → 本地的书自动上云。

## Self-Review
- 覆盖"入库不丢 + 登录 + 首登迁移"：Task 1（client+auth 闸门+本地旁路）+ Task 2（同步+首登上传）。
- 数据安全：RLS 已开，只读写自己的行；env 里是公开 publishable key（安全前提=RLS，已满足）；service key 从不进前端。
- 占位符：无 TBD；真实网络/邮件往返注明浏览器/用户验证，纯逻辑给确切断言。
- 类型一致：`supabase`/`cloudEnabled`、`authStore`(session/status/signInWithEmail/signOut/init)、`rowToBook`/`bookToRow`/`firstSyncPlan`/`startSync`、`cw_books` 列名跨任务一致。
