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
- Updated seed-10k.md in main branch, worktree was unaware of it thus it could not implement the updated plan. Once rebased with main worktree now has updated context.
- org-admin agent stopped and raised an issue where it didn't have permission to make changes for org switcher implementation, upon review permission was granted as it does own that surface area.
## [org-admin] Server-only audit() imported in "use client" component

- **Where:** `src/components/org/org-switcher.tsx:4` (org-admin worktree)
- **Why bad:** `@/lib/log/audit` imports the Drizzle DB client — server-only code. Bundling it into a client component causes a Next.js build error (`cannot import server module from client module`).
- **Fix:** Removed the import. Switch auditing happens server-side when the org layout re-renders on navigation.
- **Fix commit:** fd552e7


## [org-admin] 23503 FK violation on orgs.created_by — missing public.users profile

- **Where:** `src/lib/orgs/create.ts` — `createOrg` transaction
- **Why bad:** `orgs.created_by` is a FK to `public.users.id`. `requireUser()` returns the Supabase `auth.users` record. The `on_auth_user_created` trigger normally mirrors it into `public.users`, but users created *before* the migration ran (Supabase dashboard users, dev accounts) have no profile row — causing SQLSTATE 23503 at INSERT.
- **Symptom:** `insert or update on table "orgs" violates foreign key constraint "orgs_created_by_users_id_fk"` in production/dev.
- **Fix:** Upsert `public.users` with `onConflictDoNothing` at the start of the `createOrg` transaction so the row always exists regardless of trigger history.
- **Fix commit:** a67a74b


## [all modules] toResponse() used in server actions — returns NextResponse not Result<T>

- **Where:** `src/lib/orgs/create.ts`, `invite.ts`, `roles.ts` (and potentially notes-core actions if copied the pattern)
- **Why bad:** `toResponse(ok({id}))` returns a `NextResponse` HTTP response object. When a server action returns this and the page checks `result.ok`, it reads `NextResponse.ok` (true for any 2xx status) — so the if-branch runs. But `result.data` is undefined because `NextResponse` has no `.data` property, causing `TypeError: Cannot read properties of undefined (reading 'id')`.
- **Rule:** `toResponse()` is **route handler only**. Server actions return the raw `Result<T>` so calling pages can read `.ok`, `.data`, `.error`.
- **Fix commit:** 307c381 (org-admin branch)

## [baseline] pino transport worker thread crashes in Next.js Server Actions

- **Where:** `src/lib/log/index.ts` — `transport: { target: "pino-pretty" }` in dev
- **Why bad:** pino's `transport` option spawns a `worker_thread` for async pretty-printing. Next.js dev server recycles worker processes between requests, killing the thread and throwing `Error: the worker has exited` inside any Server Action or route handler that calls `log.*`.
- **Fix:** Replace the transport with pino-pretty as a synchronous stream (`pino(opts, prettyStream)`) — same output, no worker thread.
- **Fix commit:** ea2eedd (main)


## [notes-core] isRedirectError imported from internal Next.js path — not a function at runtime

- **Where:** `src/app/orgs/[orgId]/notes/actions.ts:5` (notes-core worktree)
- **Why bad:** `import { isRedirectError } from "next/dist/client/components/redirect"` resolves to `undefined` in Next.js 15 — the function isn't exported from that path. Calling `isRedirectError(error)` throws `TypeError: ... is not a function`, which then gets caught by the outer catch and re-redirects with a false error flash.
- **Fix:** Inline guard that checks `error.digest.startsWith("NEXT_REDIRECT")` — the stable, version-agnostic signal Next.js uses internally for all redirect throws.
- **Fix commit:** db1b195 (agent/notes-core)


---

### settings actions silently discarded errors (2026-04-27)

- **What:** Invite send, role change, and leave-org buttons appeared to do nothing in the org settings page.
- **Where:** `src/app/orgs/[orgId]/settings/page.tsx` — inline server actions `handleInvite`, `handleRoleChange`, `handleLeave`.
- **Why bad:** All three called lib functions that return `Result<T>` but ignored the return value entirely. No `redirect` or `revalidatePath` call on success, no error handling on failure — so both success and error states were silently swallowed. Invites were actually being created (visible in audit_log) but the page never re-rendered.
- **Fix:** Added `searchParams` prop, checked result in each action, added `redirect` with `?message=` on success and `?error=` on failure, flash notices rendered at top of page.
- **Fix commit:** 2f66565 (main)

---

### next@15.1.0 security vulnerabilities flagged by Railway (2026-04-27)

- **What:** Next.js 15.1.0 contains known security vulnerabilities.
- **Where:** `package.json` — `"next": "15.1.0"`.
- **Why bad:** Railway deployment pipeline flagged the pinned version as having CVEs. Running a vulnerable version in production exposes the app to potential exploits in the Next.js request handling layer.
- **Fix:** Upgraded to `next@15.1.11` (patch-only bump, no breaking changes, no API surface change). All pre-existing type errors confirmed unchanged after upgrade.
- **Fix commit:** 1dc225e (main)
