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

