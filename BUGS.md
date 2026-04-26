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
