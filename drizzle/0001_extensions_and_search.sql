-- =============================================================================
-- Extensions, generated columns, and search indexes.
--
-- This runs AFTER `drizzle-kit push` creates the base tables. It adds the bits
-- Drizzle's schema DSL can't express:
--   1. Required Postgres extensions (pgcrypto for gen_random_uuid, pg_trgm).
--   2. The GENERATED tsvector column for search.
--   3. GIN indexes on search_vector and on title/content with pg_trgm.
-- =============================================================================

-- Extensions ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated tsvector ----------------------------------------------------------
-- Drizzle declared `search_vector tsvector` as a plain column. We rewrite it
-- as GENERATED so Postgres always keeps it in sync with title + content.
-- We weight title higher (A) than body (B) for ranked relevance.
ALTER TABLE notes DROP COLUMN IF EXISTS search_vector;
ALTER TABLE notes
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) STORED;

-- Indexes ---------------------------------------------------------------------
-- GIN index for ranked full-text search.
CREATE INDEX IF NOT EXISTS notes_search_vector_idx
  ON notes USING GIN (search_vector);

-- pg_trgm GIN indexes for fuzzy/partial matching on title and content.
-- Used for "did you mean" / typo-tolerant suffixes layered on top of fts.
CREATE INDEX IF NOT EXISTS notes_title_trgm_idx
  ON notes USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS notes_content_trgm_idx
  ON notes USING GIN (content gin_trgm_ops);

-- Tags fuzzy lookup (small table, cheap)
CREATE INDEX IF NOT EXISTS tags_name_trgm_idx
  ON tags USING GIN (name gin_trgm_ops);
