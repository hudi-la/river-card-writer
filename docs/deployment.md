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

The initial frontend release leaves `VITE_RIVER_MCP_ENABLED` unset. Full article
exports work independently; MCP setup is hidden until the backend is deployed.

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
