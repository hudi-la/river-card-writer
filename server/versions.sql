-- Private article history, separate from publicly accessible shares.
CREATE TABLE IF NOT EXISTS article_versions (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('named', 'auto', 'safety')),
  created_at TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS article_versions_owner_book
  ON article_versions(owner, book_id, created_at DESC);
