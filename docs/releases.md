# River releases

## 2026-10-21 — full article export

- Source: `a4fb508a96ffff3c8df41d919a3a815086e31643`
- GitHub branch: `codex/river-fulltext-mcp` (repository renamed to `hudi-la/river-card-writer`).
- Cloudflare production deployment: `c39cad59`.
- Previous production: `16c89cac-e7e9-43f9-b828-e9c0519a1995`, source `c92881f`.
- Full article export enabled; MCP source included but backend not deployed and UI hidden.
- Validation: 791 frontend tests, production build, MCP HTTP/OAuth integration test,
  browser export preview and actual TXT download with first and last paragraphs checked.

## 2026-10-21 — shareable snapshots

Full-article sharing uses Cloudflare D1 and existing Supabase user authentication.
No Supabase schema or function deployment is needed for this feature. Deployment
source is `da386550c7970fd59ee62159f6b7425f84448919`; Cloudflare production
deployment is `a4d4dd99` (preview `a4481283`). Previous production `c39cad59`
is the rollback target. Verification: 799 frontend/server
unit tests and production build; only synthetic text is used for public smoke tests.


Production HTML and plain-text routes were checked with synthetic Chinese/English
paragraphs in exact alternating order. Unauthenticated and invalid-token management
requests returned 401. Existing Supabase auth configuration was verified separately.
No real user article was published for testing. The current GPT web fetch tool could
not open the newly created test URL, although ordinary HTTP retrieval succeeded;
therefore direct GPT link retrieval is not claimed as verified. Copy-full-text is
retained as a fallback. Synthetic snapshots are deleted after verification.

## 2026-10-21 — MCP enabled in production

- Source: `19904b2` on `codex/river-fulltext-mcp`.
- Cloudflare production deployment: `a6f44a5c`; previous: `a4d4dd99`.
- Supabase project: `jjgvvtrsnoqnoigukobi`; deployed `river-auth` and `river-mcp`.
- Applied migration `20261021000000_river_mcp_tokens` and recorded migration history.
- Server: https://card-writer.pages.dev/api/river-mcp
- Production UI now exposes the read-only connection key manager.
- Live validation: OAuth discovery, HTML consent, PKCE token exchange, code replay
  rejection, MCP initialization and three tools, owner-only search, cross-owner
  read denial, alternating Chinese/English full article and chapter output, and
  parent-key revocation invalidating the OAuth token. All synthetic test users,
  articles, tokens and OAuth client were removed.
- Frontend build passed; production asset and OAuth metadata verified. Earlier
  source validation passed 799 tests. Actual connection in the user's ChatGPT
  account remains a user setup step and is not claimed as tested.

## 2026-10-22 — share retrieval compatibility

- Source `037c9fd`, production deployment `6fdc75a2`; rollback `a6f44a5c`.
- Added real robots.txt (previously the SPA fallback returned HTML), allowing
  shared-page retrieval while disallowing GPTBot and API crawling. Share pages
  retain noindex and no-store; removed nofollow/noarchive and advertise their
  complete plain-text alternative.
- Eight sharing tests and production build passed. Live HTML/plain text and
  robots verified on river.hudiworks.com; bilingual ordering retained.
- GPT web fetch still reports inaccessible for both River homepages and shares.
  A short deployment tail recorded the curl control request (200) but no GPT
  request. This does not establish whether an upstream edge rule or the fetch
  service is responsible. Zone security inspection lacked API permissions.
  Direct HTTP reads succeed, including a ChatGPT-User user-agent; this is not
  proof that all ChatGPT clients can fetch the links. Synthetic share removed.

## 2026-10-29 accessibility

Production source: `0c5013c` on GitHub `codex/accessibility-20261028`.
Pages deployment: `4e9b0f85.card-writer.pages.dev`; custom domain resource references match the build.
Based on production `cbc6200`, retaining full article sharing, export and typeset reading.
Native shelf/outline controls, named editor, keyboard positioning controls, modal focus trapping/restoration, visible focus and reduced motion. 803 tests in 61 files and production build passed.
Rollback: previous Pages production deployment `de16b947-bd5c-4b60-865b-88a3bac5d61f`. No database migration.

## 2026-11-05 — private article version history

- Production: https://river.hudiworks.com/ (Cloudflare Pages project `card-writer`).
- Published source: `b8cac80530f4f9fe0d3e0c3b45b92ac67207c28b`.
- GitHub: `hudi-la/river-card-writer`, branch `codex/river-article-versions`.
  Source was committed and successfully pushed before deployment.
- Production deployment: `fab51765-760e-4a1f-a501-63164ef53786`
  (`https://fab51765.card-writer.pages.dev`), source `b8cac80`.
- Rollback target: `4e9b0f85-b8fe-4aa4-97b7-f0f654b65d8d`, source `0c5013c`.
  Production was rechecked immediately before release and had no newer deployment.
- Applied only `server/versions.sql` to D1 `river-shares`: additive private
  `article_versions` table and owner/article index. Existing Supabase article
  tables and public shares were not changed. Leave the new table intact on rollback.
- Signed-in users can name versions, preview paragraph additions/removals and
  card changes, download complete version backups, create independent copies, and
  restore an old version after a durable safeguard of current content. Opening
  snapshots and changed content checked every five minutes supply up to thirty
  automatic versions. History is private to its owner and includes book-specific
  materials, formatting and translations; universal boxes are excluded.
- Verification: 819 tests in 64 files (16 new feature tests), production build and
  Pages Functions compilation passed. TypeScript diagnostics match the existing
  production baseline; no new type failures. Desktop/mobile dialog and restored
  editor persistence verified in a browser with synthetic fixtures.
- Live verification: custom-domain HTML and all three referenced build assets
  match the published build by SHA-256. OAuth resource metadata and robots.txt
  retained HTTP 200. Anonymous and invalid-token history requests returned 401.
  Two temporary authenticated users verified complete immutable snapshot save/read,
  cross-owner read rejection and empty history, and automatic-history deduplication.
  A real production browser session verified named save, old-version preview,
  paragraph diff, copy, safeguard-before-restore and continued editing with no
  history API failures. Subsequent direct cloud reads confirmed the copied article,
  restored edits and the safeguard containing the replaced current content.
- Cleanup: all synthetic versions, articles, universal-box rows and both temporary
  users were removed, with zero matching private version rows and user deletion
  confirmed. Temporary credentials were deleted locally. No real user articles
  were used for acceptance testing.

## 2026-11-05 — temporarily pause note editing

- Published source: `272b7b9`, pushed to GitHub branch `codex/river-disable-notes-20261105`.
- Production: https://river.hudiworks.com/ ; deployment https://2dc08ae5.card-writer.pages.dev .
- Verified prior live source `b8cac80` / deployment `fab51765-760e-4a1f-a501-63164ef53786`; isolated checkout retains all version-history functionality.
- Disable outline hover note popovers, card-handle click note popovers and detail-view note editing using one reversible flag. Existing notes remain stored and visible; drag/reorder and document commands remain intact. No database changes.
- Verification: 817 tests across 64 files passed; production build and Functions compilation passed. Custom-domain HTML and all referenced JS/CSS assets match the published build byte-for-byte.
- Rollback: restore the prior Pages deployment above. No data rollback needed.

## 2026-11-05 — integrated outline move handles

- Published source `6fa1870`, GitHub branch `codex/river-integrated-move-handle-20261105`; deployment https://2ffa9804.card-writer.pages.dev ; production https://river.hudiworks.com/ .
- Baseline and rollback: `272b7b9`, Pages deployment `2dc08ae5-dbb4-4ae9-ba74-3aaf8a2a4d58`. No database or user-content changes.
- Removed the separate move row. Six-dot buttons now support pointer dragging and click/Enter/Space to open a destination selector, in both sidebar and detailed outline. Escape closes and returns focus. Pointer capture starts only after the drag threshold; completed drags suppress accidental clicks.
- Handles use a fixed 24px area, align vertically to their rows and share the same right edge. Reserved row padding keeps word counts clear and visible.
- Verification: initial full suite 817/817 passed; final targeted suite 67/67 passed including two new click/keyboard/drag regression tests. Production build and Functions compilation passed. Isolated Chrome fixtures verified all five hierarchy rows with zero vertical-center error and identical right edges, actual keyboard reorder, pointer reorder and no accidental menu after dragging. Screenshot reviewed. Custom-domain HTML and all referenced assets match published files byte-for-byte.

## 2026-11-11 — prevent new-manuscript and stale-tab loss

- Production https://river.hudiworks.com/ ; published source
  `2cbb7cef5e1192c7e9c771e2c57e6184198456f5`, successfully pushed before deployment
  to `hudi-la/river-card-writer`, branch `codex/river-save-safety-20261111`.
- Pages production deployment `d5b3c918-b91b-46d9-aae0-f9ce2520f1b9`
  (https://d5b3c918.card-writer.pages.dev).
- Baseline/rollback `6fa1870`, deployment `2ffa9804-e4dd-4204-ac6d-487b5a9cb4dc`;
  latest production rechecked immediately before publishing. No database migrations.
- New books use UUIDs immediately. Automatic/manual saves share an acknowledged,
  serialized retry queue; failed downloads no longer imply an empty cloud.
  Per-book local records recover manuscripts after stale whole-library overwrites;
  detected same-book window conflicts retain both versions. Persistent sync/disk
  error status provides retry and backup actions.
- Baseline-failing reproductions and production read-only UUID rejection establish
  the defects. Exact historical tab-write sequence is not available. Details and
  remaining cross-device/storage limits: `docs/save-safety-20261111.md`.
- Validation: full suite 833/833 before final local-write acknowledgement fix;
  final affected store/snapshot/loss regressions 100/100 (one additional test).
  Production build and Functions compilation pass; no new TypeScript diagnostics.
  Synthetic browser fixture verified offline error/retry controls and recovery
  after simulated stale-library overwrite/reload, without real user data.
- Live custom-domain HTML and all referenced JS/CSS match build bytes. Entry
  `main-C_U4NNtX.js`, shared `styles-D6oNj9S7.js`, CSS `styles-D9MeSbYU.css`.
  Signed-in production browser displayed the recovered manuscript and transitioned
  from syncing to cloud-saved. No user manuscript edited for verification.
- Existing browser tabs keep the previous JavaScript until reopened/refreshed;
  preserve any unsaved contents before refreshing. Rollback leaves local per-book
  records and private cloud histories intact but reintroduces old save behavior.

## 2026-11-11 — manuscript recovery and destructive-save safeguards

- Production https://river.hudiworks.com/ ; published source
  `979498b9283ff9f540ed654db02ba14dc0b7218c`, pushed to GitHub branch
  `codex/river-recovery-audit-20261111` before publishing.
- Pages deployment `a52aed00-daba-4a33-bf3d-734b1f5d011c`
  (https://a52aed00.card-writer.pages.dev).
- Baseline/rollback: source `2cbb7ce`, deployment
  `d5b3c918-b91b-46d9-aae0-f9ce2520f1b9`; rechecked before publishing.
  No database migration; rollback retains cloud history and restored copies.
- Add owner-scoped manuscript recovery with latest non-empty history, full preview,
  pagination and restoration as a separate copy. Account changes invalidate pending previews.
- Update mounted editor when the same document changes externally; reject delayed
  writes to another book and preserve conflicting edits as independent copies.
- Require a historical snapshot before syncing a clear/delete; failed snapshots
  preserve the pending operation for retry without destructive cloud writes.
- Audited available private histories and backups; recovered missing content with
  verified, additive inserts. User data and private audit files are excluded from Git.
- Validation: 843 tests across 68 files pass; production and Functions builds pass;
  no new TypeScript diagnostics versus baseline. Old-source reproduction fails as
  expected. Local browser verifies remote document replacement and copy recovery.
  Signed-in production verifies restored books, cloud-saved status, recovery listing
  and full preview without editing manuscripts. Main/share HTML and all referenced
  JS/CSS match local build bytes (following the standard share.html redirect).
- Existing tabs load the fixes when reopened/refreshed; preserve unsaved work first.
  Full cross-device compare-and-swap conflict resolution remains outside this release.
