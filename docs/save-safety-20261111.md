# Manuscript saving safety — 2026-11-11

Production baseline: source `6fa1870`, Pages deployment
`2ffa9804-e4dd-4204-ac6d-487b5a9cb4dc`, https://river.hudiworks.com/ .
Work uses the existing isolated checkout (clean `0bf18ad`, release documentation
only after the live source), not the older desktop checkout.

## Findings

- Fresh books used nanoid, while `cw_books.id` is UUID. Only initial sync remapped
  IDs, so books created after login could not upload. The missing manuscript's
  private history retained its nanoid throughout. A read-only production filter
  using that ID returned PostgreSQL `22P02` (invalid UUID). No user data was written
  by this diagnostic.
- Automatic upserts ignored returned errors, discarded their queue before success,
  and did not report failure. Rejected requests had no catch/retry.
- Each browser tab persisted its entire in-memory library. A stale tab editing an
  unrelated book could overwrite a new, not-uploaded manuscript in localStorage.
  Both the UUID defect and old-tab overwrite were reproduced as failing tests on
  the production baseline. We do not have a historical browser write log proving
  the exact tab/write that removed this particular manuscript.
- Manual save uploaded every book from the tab, including unchanged stale books.
  Initial sync did not subscribe to edits until its asynchronous work finished.

## Changes

New books and collision copies use UUIDs immediately; legacy IDs encountered in
sync are normalized before upload. A serialized, acknowledged outbox preserves
failed/newer writes, retries with bounded backoff, retries on reconnection, tracks
edits during initial download, and refuses to treat failed reads as empty data.
Manual saves use the same active queue. Pending writes trigger a close warning;
hiding the page starts a best-effort flush (not a guarantee the browser will wait).

Per-book local records are written only for changed books, independently of the
legacy library index. Startup recovers missing records even if an older tab has
replaced that index. Existing drafts are seeded on first load. When another tab's
same-book edits are detected, its version is retained as a visible separate copy.
Explicit removals keep a complete local record marked deleted. Storage failures
are surfaced in a persistent banner with an export action; cloud success cannot
hide local storage failure. Cloud status shows saving, saved, or retryable error.

This is not a full cross-device conflict-resolution protocol. Simultaneous edits
on separate devices can still have last-writer behavior; existing private version
history remains available. Clearing browser site data removes local safeguards.
No software can promise survival of every device/storage failure; visible errors,
independent records, cloud persistence and existing history supply separate layers.

## Validation

- 833 tests in 66 files pass, including baseline-failing UUID and stale-tab cases,
  old whole-library overwrite followed by reload, same-book conflict preservation,
  disk quota errors, returned/rejected network errors, retrying deletion, delayed
  initialization, serialized manual/auto saves, continued edits in flight, stopped
  sessions and visible failure/backup controls.
- Production build and Pages Functions compilation pass. TypeScript diagnostics
  match baseline after removing source locations; no new diagnostics.
- Browser fixture `qa/saving.html` uses synthetic data and a local mock cloud only.
  Verified a new draft remains visible on failed upload with retry/export actions;
  after simulated old-library overwrite and reload it recovers and synchronizes.
- No database schema changes. No user manuscript is used as a test fixture.

## Release and rollback

Commit and push this branch before Pages production deployment. Verify production
still points to the baseline immediately before publishing. Record source SHA and
Pages ID in `docs/releases.md`; verify custom-domain asset hashes and the live UI.
Rollback via Pages to the baseline deployment above, leaving all local draft
records and existing cloud history intact. A rollback reintroduces the old save
behavior, so prefer a forward fix for any newly discovered issue.
