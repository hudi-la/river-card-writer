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
identity will be appended after publishing. Verification: 799 frontend/server
unit tests and production build; only synthetic text is used for public smoke tests.
