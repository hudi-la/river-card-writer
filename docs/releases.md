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

## 2026-10-28 — preserve share layouts

- Source `cbc6200`; production `de16b947`; previous/rollback `6fdc75a2`.
- Added nullable `shares.snapshot` using `server/shares-layout.sql` before release.
- Shares reuse the existing TypesetView book/paper layouts in read-only mode,
  retaining selected layout, sanitized rich text, cover, subtitle and author.
  Bilingual output interleaves paired paragraphs; translated chapter headings
  avoid the extra chapter-sized gap. Readers can switch presentation locally.
- Existing links render their original saved text in the book reader; recreating
  a share captures formatting that older snapshots never stored. Full text
  remains server-rendered and `/text` remains available without JavaScript.
- Validation: 801 tests passed before final visual spacing/fallback refinement;
  25 relevant tests passed after it, production build passed. Repository-wide
  tsc still reports existing unrelated errors, none in changed implementation.
- Browser verification on production: saved book/paper defaults, cover and
  read-only metadata, bilingual order, 30-paragraph two-column article through
  its last paragraph, and reader layout switching. HTTP assets and plain text
  verified. Synthetic snapshots removed; no user article published for tests.
