# River deployment

River is the Cloudflare Pages project `card-writer`, at https://card-writer.pages.dev .
This is a separate app from Fairwind.

## Baseline and frontend

2026-10-21: Cloudflare production deployment `16c89cac-e7e9-43f9-b828-e9c0519a1995`
reports source `c92881f`, matching GitHub main. Work is based on an isolated clone
of that commit, not the older desktop checkout (`7d23631`).

1. `npm ci`, `npm test`, `npm run build`.
2. Commit the actual source and push the branch to GitHub before deployment.
3. `wrangler pages deploy dist --project-name card-writer --branch main --commit-hash <source-commit>`.
4. Verify the production asset hashes and export dialog. Record the deployment ID
   and source commit in `docs/releases.md`.
5. Roll back using Cloudflare Pages' rollback action to the previous production
   deployment above. Do not overwrite the desktop checkout or user data.

Production enables MCP with the tracked `.env.production` flag
`VITE_RIVER_MCP_ENABLED=true`. Both Supabase MCP functions and the token migration
were deployed on 2026-10-21. Full article exports work independently.

## MCP backend (requires Supabase deployment login)

No model API key is needed. MCP exposes only `search_articles`, `read_article`,
and `read_chapter`; it does not send content to a model itself.

1. Run `supabase login` and identify the project matching `VITE_SUPABASE_URL` in
   the existing ignored `.env`. Do not paste credentials into chat or commit them.
2. Inspect existing `cw_books` schema (`id`, `owner`, `title`, `data`, `updated_at`)
   and migration history. Apply only
   `supabase/migrations/20261021000000_river_mcp_tokens.sql` after reviewing the
   migration plan. This migration adds new tables; it does not change articles.
   Do not blindly push migrations over an existing remote history.
3. Set Supabase secret `RIVER_PUBLIC_ORIGIN=https://card-writer.pages.dev`.
4. Deploy `river-auth` and `river-mcp` functions with the project ref and
   `--no-verify-jwt`. These functions implement their own OAuth and bearer-key
   checks. The service-role key remains server-side.
5. Set Cloudflare Pages variable `RIVER_SUPABASE_URL` to the public Supabase URL
   in both relevant environments. Pages Functions proxy only the MCP/OAuth paths.
6. Build with `VITE_RIVER_MCP_ENABLED=true`, commit/push and publish the frontend.
7. Test root OAuth discovery, DCR, PKCE consent/token exchange and authenticated
   MCP tools. Verify token expiry, parent-key revocation and owner isolation.
8. In River account menu, open “连接 GPT / MCP”, generate a read-only key. Add
   `https://card-writer.pages.dev/api/river-mcp` in ChatGPT with OAuth. During the
   consent step, paste the key into River's authorization form. Keys expire after
   90 days, are stored only as SHA-256 hashes, and can be revoked in River.
   Revoking a parent key cascades to OAuth access tokens and unused codes.

OAuth supports public clients registered with HTTPS redirects and S256 PKCE.
There is no refresh token: reconnect after expiry. Registration and authorization
should be covered by host request-rate controls before broad public promotion.
The database's RLS protects key management. All article queries additionally bind
`owner` from the authenticated token; request arguments cannot choose an owner.

## Output rules

Exports and MCP use `supabase/functions/_shared/article.ts`. Default output is
Chinese paragraph, English paragraph, repeated, preserving document order.
Missing English stays missing. Materials, hints and card notes are excluded;
folded正文 remains included. Mismatched paragraph counts are visibly flagged and
preserved per card without inventing alignment. Chapter reads that would cut an
unaligned card fail explicitly and direct the caller to read the whole article.

MCP returns up to 16,000 text characters per page, version hash and nextOffset.
Subsequent pages must use the version hash; changed documents require a restart.
`complete` means this page reaches the end, not that previous pages were read.

## Verification

- `npm test -- src/export/article.test.ts src/ui/ArticleExport.test.tsx src/ui/Bookshelf.test.tsx`
- `deno check --node-modules-dir=none supabase/functions/river-mcp/index.ts supabase/functions/river-auth/index.ts`
- `deno test --allow-env --node-modules-dir=none supabase/tests/mcp_test.ts`

The HTTP integration test uses fake database rows and tests actual SDK transport,
OAuth redirect binding, PKCE, one-time codes, revoked keys and owner isolation.
Never use real user articles as test fixtures.

## Full-article sharing (primary workflow, 2026-10-21)

Sharing does not require the MCP functions or a Supabase deployment login.
Cloudflare Pages Functions use `RIVER_SHARES` (D1) for explicit snapshots and
validate the user's existing Supabase session through `/auth/v1/user` before
creating, listing, or revoking shares. `wrangler.json` declares the D1 binding.
The public Supabase key is provisioned as the Pages secret
`RIVER_SUPABASE_PUBLISHABLE_KEY`, never committed. The public URL is a variable.

- Apply `server/shares.sql` to the dedicated `river-shares` database.
- Publish with the existing Pages workflow; check bindings in the deploy output.
- Account owners create snapshots by clicking “分享全文 → 创建分享链接”.
- `/s/<random-256-bit-id>` returns server-rendered HTML, with no login or JS needed.
- `/s/<id>/text` returns the exact complete plain text, suitable for model reading.
- Links are bearer access: anyone with a link can read it. No directory or public
  listing is exposed. Responses prohibit caching and search indexing and suppress
  referrers. Indexing directives cannot retract copies already taken by readers.
- Revoke removes only the snapshot, never the original document. Future edits do
  not change published snapshots. Re-share explicitly to publish a new version.
- Both language versions use the same interleaving renderer as exports and MCP.
- Up to 100 active snapshots per owner; requests over 1 MiB fail without truncating.

`src/export/shares.test.ts` uses real in-memory SQLite with the deployment schema
and tests snapshot immutability, owner isolation, revocation, escaping, complete
bilingual text and size handling. `src/ui/ArticleShare.test.tsx` covers explicit
publication, payload exclusions, copying, revocation and the login prerequisite.

## Shared typeset reader (2026-10-28)

Apply `server/shares-layout.sql` once to existing D1 databases before deploying.
New databases use the updated `server/shares.sql`; do not run the ALTER twice.
Shares now store a sanitized rich-text snapshot plus selected book/paper layout,
cover, subtitle and author. No notes, boxes or hints are included. `share.html`
is a Vite entry; the Pages route obtains its hashed asset tags through
`context.next` and embeds the snapshot alongside server-rendered full text.
The reader reuses TypesetView in read-only mode with local display switches.
The plain-text endpoint is unchanged. Old links use their original saved text
with the book reader; they cannot recover formatting never stored. Re-sharing
is required to capture the original rich formatting and chosen layout.
Rollback to the previous Pages deployment; the nullable column is additive and
compatible with the previous code. Do not drop the column or alter user shares.

## Private article versions (2026-11-05)

This change is based on verified production source `0c5013c` (Pages deployment
`4e9b0f85-b8fe-4aa4-97b7-f0f654b65d8d`), with its release documentation `d0905ea`.

Before publishing this feature, apply **only** `server/versions.sql` to the existing
`river-shares` D1 database. It creates a separate private `article_versions` table
and index; it does not alter shares, Supabase articles, or user content. Use the
existing `RIVER_SHARES` binding and Supabase login validation. Do not run the
sharing schema again. Example from the isolated checkout:

```
wrangler d1 execute river-shares --remote --file server/versions.sql
```

Build, commit/push actual source, then publish using the existing Pages workflow.
Verify authenticated save/list/read, owner isolation, automatic history, copy, and
restore with synthetic articles only. Record the source commit and deployment ID
in releases.md. Until the schema and code are deployed, the production UI is
unchanged. Rollback uses the previous Pages deployment; leave the additive private
history table intact to preserve saved versions.

Behavior: signed-in article views save an opening snapshot, then check for changes
every five minutes while mounted. Unchanged content is skipped; failed automatic
saves retry at the next interval and display a warning in version history. There
is no offline cloud-history queue. Named versions and restore safeguards are kept;
automatic history retains thirty snapshots per owner/article. Each request is
limited to 1 MiB without truncation; each article allows 1000 permanent versions.
Restoring aborts if safeguarding fails or the article/account changes during the
save. All book fields are included, including book-specific material boxes;
library-wide universal boxes and reading preferences are not restored. A restored
editor is remounted so its next edit cannot write its previous document back.

Comparison shows paragraph additions/removals, side-by-side article text and card
change/order counts. Very long comparisons fall back to larger changed paragraph
blocks with complete text retained. Versions can also be downloaded as complete
book backups. Private history never creates a public share URL.

Pre-release verification (2026-11-05): 819 tests in 64 files passed (16 new feature
tests); production build and Pages Functions compilation passed. Browser checks
with synthetic article/session verified paragraph diff, desktop/mobile dialog,
restore, editor remount and persistence of subsequent edits. The existing workspace
has horizontal overflow at phone width; the version dialog itself does not overflow.
Full TypeScript diagnostics are identical to production baseline after path
normalization (existing test typing failures, none added by this feature).
This verification was completed before remote schema changes or deployment;
see docs/releases.md for the subsequent production release record.

## Recovery and stale-editor protection (2026-11-11)

Based on production `2cbb7ce` / deployment `d5b3c918-b91b-46d9-aae0-f9ce2520f1b9`.
No schema migration: the recovery listing reads the existing private D1 version
table and authenticates exactly like the per-article history endpoints. It returns
50 latest non-empty article versions per page, scoped to the authenticated owner,
including articles no longer in the main shelf. Preview validates the book and
restores only as a new UUID copy; account changes invalidate preview/restore.

The mounted editor now follows external same-ID document changes without emitting
a save. Transactions bind to the mounted book and their document baseline;
conflicting content is retained as a separate copy instead of replacing the newly
loaded revision. The stale-editor regression fails against the previous live source.
Before emptying/deleting a non-empty book, sync saves its full previous version as
a permanent safety version and refuses the destructive cloud write if that fails.
This also applies to an empty local version uploaded after reconnection. Existing
size/count limits on permanent history remain: failure is visible and retryable.

Verification: 843 tests / 68 files, production build and Functions compilation.
No new TypeScript diagnostics relative to baseline. Browser synthetic fixture
`qa/recovery.html` verifies external document loading, history preview and additive
recovery without reading or writing production manuscripts. Audit/restore user
backups are private local artifacts, never committed. Code rollback is the baseline
Pages deployment above; leave recovered articles and existing history intact.
