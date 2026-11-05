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
