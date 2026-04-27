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

---

### Dockerfile COPY fails — missing public/ directory (2026-04-27)

- **What:** Docker build errors at `COPY --from=builder /app/public ./public` in the runner stage.
- **Where:** `Dockerfile` runner stage, line ~48. `public/` was never created in the repo.
- **Why bad:** Hard build failure — image cannot be produced, deployment blocked entirely.
- **Fix:** Created `public/.gitkeep` so the directory exists in the build context.
- **Fix commit:** 3972bdb (main)

### Invalid [[services]] table in railway.toml (2026-04-27)

- **What:** `[[services]]` array table is not valid Railway TOML for single-service deployments.
- **Where:** `railway.toml` lines 16-17.
- **Why bad:** Not a hard blocker but invalid config that Railway silently ignores; confusing and could cause issues on future Railway CLI versions.
- **Fix:** Removed the block — `[build]` and `[deploy]` are sufficient for a single service.
- **Fix commit:** 3972bdb (main)

### NEXT_PUBLIC_* vars must be Railway build variables (2026-04-27)

- **What:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` are baked into the Next.js bundle at build time.
- **Where:** Railway project settings — Build Variables tab.
- **Why bad:** If only set as runtime env vars, the client bundle gets `undefined` for all three — Supabase client won't initialise, auth flows break silently.
- **Fix:** Not a code fix. Must be configured in Railway: Settings → Variables → add each as a Build Variable in addition to (or instead of) a runtime variable. Dockerfile already has the correct `ARG` declarations.
- **Fix commit:** N/A — operational configuration required.

---

### Production build blocked by 8 type/lint errors (2026-04-27)

- **What:** `npm run build` failed — ESLint errors and TypeScript type errors across 10 files.
- **Where:** `log/index.ts`, `invite/[token]/page.tsx`, `files-client.tsx`, `ai/schema.ts`, `auth/permissions.ts`, `files/index.ts`, `validation/result.ts`, `supabase/middleware.ts`, `supabase/server.ts`, `env.ts`.
- **Why bad:** Deployment blocked. None were caught earlier because `tsc --noEmit` was used for spot-checks but the Next.js build runs stricter ESLint + full type compilation.
- **Notable sub-bugs:**
  - `"UNPROCESSABLE"` missing from `ErrorCode` union — used in 3 places but never declared; silent until build.
  - Drizzle infers left-join enum default as literal type (`"view"` not `"view" | "edit"`) — required `(value as string) === "edit"` workaround.
  - `ANTHROPIC_API_KEY: z.string().min(1).optional()` rejects empty string `""` — fails build when `.env` has the key blank.
- **Fix commit:** 2ff2775 (main)

## [search] filter-only searches silently ignored — shouldSearch gated on q (2026-04-27)

**Where:** `src/app/orgs/[orgId]/search/page.tsx:69` — `shouldSearch = Boolean(filters.q)`

**Found by:** Orchestrator, user reported tag filter and other filters not working

**What:** The search page only triggered a search when a text query (`q`) was present. Tag filter, author filter, and date-range filters submitted without a `q` all hit the "Enter a query" empty state instead of running. Additionally `searchRequestSchema` made `q: min(1)` required, so the `/api/search` route also returned 400 for filter-only requests.

**Why bad:** Core feature broken. Selecting a tag from the autocomplete dropdown or filtering by author produced no results — silently, with no error shown.

**Fix:**
- `shouldSearch` changed to `hasActiveSearchFilters(filters)` — any active filter triggers a search.
- `searchRequestSchema` made `q` optional (removed `.extend({ q: required })`).
- Added `browseFiltered()` in `service.ts` — applies all base conditions with `updatedAt DESC` sort when `q` is absent. `searchNotes()` routes to it when `!input.q`.
- Fixed `input.q.slice(0, 256)` in audit call — would throw when `q` is undefined.

**Fix commit:** `b1399be` on `main`

---

## [observability] Permission denials and action failures logged nowhere (2026-04-27)

**Where:** `src/lib/auth/permissions.ts` — `assertCan*` helpers; `src/app/orgs/[orgId]/notes/actions.ts` — all five catch blocks

**Found by:** Orchestrator audit of logging coverage

**What:** `assertCanReadNote`, `assertCanWriteNote`, `assertCanShareNote` threw `PermissionError` with zero log output. All five note server actions caught errors and redirected to a flash message without any `log.*` call. Result: no server-side trace of unauthorized access attempts or unexpected failures.

**Why bad:** Two gaps:
1. Security — if a user probes notes they can't access, there is no observable signal in logs or audit_log. Impossible to detect or alert on unauthorized access patterns.
2. Reliability — DB errors, deadlocks, and unexpected exceptions silently become flash messages with "Unexpected notes error". No ops signal to investigate.

**Fix:**
- `permissions.ts`: `assertCan*` helpers emit `log.warn({ noteId, userId, reason }, "note.permission_denied:<action>")` before throwing.
- `actions.ts`: each catch block maps the error with `toNotesErr`, then `log.error` for `INTERNAL` codes, `log.warn` for `FORBIDDEN` codes. Expected user errors (`NOT_FOUND`, `CONFLICT`) are not logged — they surface as flash messages and are not actionable ops events.

**Fix commit:** `31741f3` on `main`

---

## [auth] getCurrentUser() used getSession() — unauthenticated session data (2026-04-27)

**Where:** `src/lib/auth/session.ts:14` — `getCurrentUser()` implementation

**Found by:** Supabase SDK runtime warning observed during file upload testing

**What:** `getCurrentUser()` was switched to `supabase.auth.getSession()` in a performance optimisation. The Supabase SDK emits an explicit warning: "Using the user object as returned from `getSession()` could be insecure — this value comes directly from the storage medium (usually cookies) and may not be authentic." `getUser()` authenticates the token by contacting the Supabase Auth server; `getSession()` does not.

**Why bad:** Any server action or route handler that calls `requireUser()` / `getCurrentUser()` could act on a tampered session cookie. The middleware validates the JWT on each request, but middleware runs in the Edge runtime before server components — a crafted cookie could theoretically satisfy middleware's check via a valid JWT structure while having incorrect `sub` / `email` claims that only `getUser()` would catch via the introspection endpoint.

**Fix:** Reverted to `supabase.auth.getUser()` in `getCurrentUser()`. The `cache()` wrapper deduplicates this to one network call per render tree. The DB pool fix (`max: 5`) already covers the main latency regression.

**Fix commit:** `8b14459` on `main`

---

## [files] createUpload swallowed Supabase StorageError — UPSTREAM undiagnosable (2026-04-27)

**Where:** `src/lib/files/index.ts:233` — `createUpload()` error branch

**Found by:** Orchestrator, after user reported `{"ok":false,"code":"UPSTREAM","message":"Could not create a signed upload URL"}` with no further detail

**What:** When `storage.createSignedUploadUrl()` returns an error, the code threw a `FilesError("UPSTREAM", …)` without logging the underlying `StorageError`. The actual Supabase error (wrong bucket name, missing service-role key, RLS denial, etc.) was silently discarded.

**Why bad:** Completely undiagnosable from logs. The user sees a generic error; operators have no signal to distinguish "bucket doesn't exist" from "wrong API key" from "network timeout".

**Fix:** Added `log.error({ err: error, bucket: FILES_BUCKET, storagePath }, "files.signed_url_failed")` before the throw so the real StorageError is visible in server logs.

**Fix commit:** `8b14459` on `main`

---

## [ai-summary] getSummaryMatchingNoteIds missing org filter — cross-tenant note ID leak

**What:** `src/lib/ai/summary-search.ts` `getSummaryMatchingNoteIds(orgId, term)` accepted `orgId` as a parameter but never used it in the query. It searched `ai_summaries` across all orgs and returned note IDs from every tenant.

**Where:** `/private/tmp/notes-app-ai-summary/src/lib/ai/summary-search.ts` (initial commit `a6fc868`)

**Why bad:** Any user searching notes in org A could surface note IDs (and therefore summary content) from org B if the search term matched. Even though the final notes-core query would filter by orgId before returning rows to the user, the intermediate function was not safe to call in isolation — defense in depth requires each function to enforce its own tenant boundary.

**Fix:** Added `INNER JOIN notes ON notes.id = ai_summaries.note_id` with `eq(notes.orgId, orgId)` and `isNull(notes.deletedAt)` directly in the query. The org boundary is now enforced at the query site.

**Fix commit:** `7a780c9` on `agent/ai-summary`

---

## [HIGH] files page unbounded query — potential memory/latency cliff (commit 481d8e9)

**Where:** `src/lib/files/index.ts:54` — `listFilesForOrg()` (original)

**Found by:** Orchestrator review, 2026-04-27

**What:** `listFilesForOrg` had no `.limit()` — it fetched every non-deleted org file in a single query, then post-filtered visibility in JS, then serialised the entire result set into a single JSON response.

**Why bad:** With the 10k-note seed (up to 5 files/note = ~50k rows), this was an unbounded DB read, full result set materialised in Node.js memory, and a single HTTP response potentially hundreds of MB in size. Would OOM or time out in production.

**Fix:** Added `FILES_PAGE_SIZE = 50` limit, composite cursor `(createdAt DESC, id ASC)` for stable keyset pagination. API returns `nextCursor`; client accumulates pages with a "Load more" button. `PAGE_SIZE + 1` fetch detects whether a next page exists after JS visibility filtering.

**Fix commit:** `481d8e9` on `main`

---

## [HIGH] Auth redirects resolve to 0.0.0.0:8080 on Railway (commit 99fcba4)

**Where:** `src/app/auth/callback/route.ts` and `src/app/auth/sign-out/route.ts` — all `NextResponse.redirect()` calls

**Found by:** User, post-deployment, 2026-04-27

**What:** Both the magic-link callback and sign-out route built redirect URLs by cloning `request.nextUrl`. Behind Railway's reverse proxy, `request.nextUrl.origin` is the internal bind address (`0.0.0.0:8080`), not the public Railway domain. Every auth redirect sent the browser to `https://0.0.0.0:8080/...`.

**Why bad:** Magic link login and sign-out were completely broken in production. Users clicking the email link landed on an unreachable address; the OTP then expired before they could recover.

**Fix:** Added `publicUrl(path, request)` helper in `src/lib/auth/public-url.ts`. Reads `x-forwarded-host` and `x-forwarded-proto` headers set by Railway's proxy to reconstruct the correct public base URL. Falls back to `request.nextUrl.origin` in local dev where no proxy is present. Both auth routes replaced all `request.nextUrl.clone()` redirects with `publicUrl()`.

**Fix commit:** `99fcba4` on `main`
