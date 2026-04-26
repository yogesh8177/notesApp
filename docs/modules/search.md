# Module: search

> Worktree branch: `agent/search`
> Read root `CLAUDE.md` first.

## Scope

Search across titles, content, and tags within an org. Org boundary +
visibility/sharing strictly respected. Designed for ~10k notes.

## Files you own

- `src/lib/search/**` — query builders, ranking helpers.
- `src/app/orgs/[orgId]/search/**` — search UI (input, results,
  highlighting, facets/filters).
- `src/app/api/search/**` — if you need a route handler (e.g. for
  cacheable JSON, autocomplete).

## Frozen — DO NOT MODIFY

- `notes.search_vector` is a GENERATED column. Don't try to write to it,
  don't redefine it. It's maintained automatically.
- The pg_trgm and GIN indexes (`notes_search_vector_idx`,
  `notes_title_trgm_idx`, `notes_content_trgm_idx`, `tags_name_trgm_idx`)
  are already in place. Check `EXPLAIN` to verify they're used.

## Required behavior

### Query

The search query MUST:

1. **Always** include `org_id = $1` and `deleted_at IS NULL` in WHERE.
   Cross-tenant leakage is the #1 risk in this module.
2. Use `search_vector @@ plainto_tsquery('english', $query)` (or
   `websearch_to_tsquery` if you want operator support) for relevance.
3. Order by `ts_rank_cd(search_vector, query) DESC, updated_at DESC`.
4. **Defense in depth** — the query runs as the signed-in user via the
   Supabase client, so RLS will enforce visibility/sharing, but you should
   also write the WHERE clause to be correct independently.
5. Layer pg_trgm: when no fts hits, retry with `title % $query` for
   typo tolerance, OR include `similarity(title, $query) > 0.3` as an
   OR clause.
6. Tag search: separate path. If query starts with `#tag`, look up the
   tag row in this org and filter by `note_tags.tag_id`.

### UI

- Input box, `useDeferredValue` for debouncing.
- Result rows: title, snippet (`ts_headline`), tags, last-updated, author.
- Filters: visibility (private/org/shared), tag, author.
- Pagination — limit 25, offset by page; **don't post-filter in JS** — that
  breaks pagination after RLS denies rows.

### Performance

- One round-trip per query.
- Run `EXPLAIN ANALYZE` against the 10k seed to verify GIN index usage.
- If `EXPLAIN` shows seq scan, your WHERE order is wrong; lead with
  `org_id` then `search_vector @@ ...`.

## Things to test

- Search for content that exists in ORG A while signed in as a member of
  ORG B — must return 0 results.
- Search for a term in a `private` note authored by user X while signed in
  as user Y in the same org — must NOT appear.
- Search for a term in a `shared` note where Y has no share row — must NOT
  appear.
- Typo: title is "Onboarding"; search for "Onboardig" — should still rank.
- Tag prefix search.
- 10k notes: query under 200ms p95.

## Audit events

`search.execute` is OPTIONAL but recommended for ops visibility — log the
query (truncated to 256 chars), org_id, user_id, result count, latency_ms.
DO NOT log raw note content from result rows.

## Commit conventions

- `feat(search): tsvector ranked query builder`
- `feat(search): trgm fallback for typos`
- `feat(search): tag-prefix path`
- `feat(search): results page UI`
- `perf(search): verify GIN index used (EXPLAIN ANALYZE)`
