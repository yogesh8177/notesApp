# BUGS.md

> Bugs found during review, with file:line, severity, and fix commit SHA.
> Specificity > volume. If you can't point at a line, you didn't find it.

Format:

```
## [SEV] Title (commit <sha>)

**Where:** path/to/file.ts:LINE
**Found by:** orchestrator | notes-core agent | …
**What:** one-sentence description.
**Why bad:** the impact (data leak, broken UX, perf cliff, etc.).
**Fix:** what we changed.
```

Severities: **CRITICAL** (data leak, RCE, auth bypass) · **HIGH** (broken
core feature, perf cliff) · **MED** (UX bug, minor edge case) · **LOW**
(cosmetic, doc).

---

## Baseline review punch list (to actively check post-merge)

- [ ] Verify `notes.search_vector` is GENERATED after migration runs
      (`\d+ notes` in psql).
- [ ] Verify RLS denies anon SELECT on every table (smoke test with anon JWT).
- [ ] Verify storage bucket `notes-files` is `public = false`.
- [ ] Verify `auth.users` insert triggers `public.users` row creation.
- [ ] Verify magic-link callback rejects external `redirect_to`.
- [ ] Verify `prepare: false` on the pg client (Supabase pooler).
- [ ] Verify `getNotePermission` matches SQL `can_read_note` / `can_write_note`
      across all visibility/role combos (dedicated test in notes-core).
- [ ] Verify the org switcher cookie is never used for authorization
      (search for reads of `active_org_id` cookie).

---

## Findings

### [search] Admin/owner bypass exposed private notes — service.ts `buildReadablePredicate`

- **What**: `buildReadablePredicate` returned `sql\`true\`` for `owner`/`admin` roles, meaning org owners could read every note including `private` ones authored by other users.
- **Where**: `src/lib/search/service.ts` in Dewey's uncommitted draft.
- **Why bad**: Visibility is user-relative, not role-relative. A private note must only be readable by its author regardless of the caller's org role. This would silently bypass a core access-control rule.
- **Fix**: Removed the `isOrgAdmin` branch entirely. Same predicate for all callers: author match OR visibility=org OR shared with explicit note_share row.
- **Commit**: `0e58a2e` on agent/search

---

### [search] Tag filter in HAVING broke pagination — service.ts

- **What**: `input.tag` filter was computed as `coalesce(bool_or(...), false)` in `.having()`. Post-aggregation HAVING filtering is fine logically but inconsistent with a WHERE-based pagination model where LIMIT/OFFSET should be applied after all filters.
- **Where**: `src/lib/search/service.ts`, `.having()` clause in Dewey's draft.
- **Why bad**: Any row denied by RLS or the visibility predicate inside the GROUP is excluded before HAVING — so HAVING sees the right set in that sense. But using a WHERE EXISTS subquery is cleaner, more efficient (the DB can use the index on `note_tags.note_id`), and avoids a subtle ordering-of-operations concern.
- **Fix**: Moved tag filter to WHERE as an EXISTS subquery with `lower(t.name) = lower(input.tag) AND t.org_id = orgId`.
- **Commit**: `0e58a2e` on agent/search

---

### [search] #tag prefix path missing — service.ts

- **What**: Module spec requires: "If query starts with `#tag`, look up the tag row in this org and filter by `note_tags.tag_id`." Dewey's draft had no such path.
- **Where**: `src/lib/search/service.ts`
- **Why bad**: Tag chips in the UI link to `#tagname` queries. Without the path, a `#` prefix falls through to FTS where `websearch_to_tsquery` treats it as a plain word, yielding poor/wrong results.
- **Fix**: Added `searchByTag()` — looks up tag by (orgId, lower(name)), then filters notes via EXISTS on `note_tags.tag_id`. Falls through to `searchByFts` for non-prefixed queries.
- **Commit**: `0e58a2e` on agent/search

