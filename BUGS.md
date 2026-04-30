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

## [HIGH] [search] Admin/owner bypass exposed private notes — service.ts `buildReadablePredicate`

- **What**: `buildReadablePredicate` returned `sql\`true\`` for `owner`/`admin` roles, meaning org owners could read every note including `private` ones authored by other users.
- **Where**: `src/lib/search/service.ts` in Dewey's uncommitted draft.
- **Why bad**: Visibility is user-relative, not role-relative. A private note must only be readable by its author regardless of the caller's org role. This would silently bypass a core access-control rule.
- **Fix**: Removed the `isOrgAdmin` branch entirely. Same predicate for all callers: author match OR visibility=org OR shared with explicit note_share row.
- **Commit**: `0e58a2e` on agent/search

---

## [MED] [search] Tag filter in HAVING broke pagination — service.ts

- **What**: `input.tag` filter was computed as `coalesce(bool_or(...), false)` in `.having()`. Post-aggregation HAVING filtering is fine logically but inconsistent with a WHERE-based pagination model where LIMIT/OFFSET should be applied after all filters.
- **Where**: `src/lib/search/service.ts`, `.having()` clause in Dewey's draft.
- **Why bad**: Any row denied by RLS or the visibility predicate inside the GROUP is excluded before HAVING — so HAVING sees the right set in that sense. But using a WHERE EXISTS subquery is cleaner, more efficient (the DB can use the index on `note_tags.note_id`), and avoids a subtle ordering-of-operations concern.
- **Fix**: Moved tag filter to WHERE as an EXISTS subquery with `lower(t.name) = lower(input.tag) AND t.org_id = orgId`.
- **Commit**: `0e58a2e` on agent/search

---

## [HIGH] [search] #tag prefix path missing — service.ts

- **What**: Module spec requires: "If query starts with `#tag`, look up the tag row in this org and filter by `note_tags.tag_id`." Dewey's draft had no such path.
- **Where**: `src/lib/search/service.ts`
- **Why bad**: Tag chips in the UI link to `#tagname` queries. Without the path, a `#` prefix falls through to FTS where `websearch_to_tsquery` treats it as a plain word, yielding poor/wrong results.
- **Fix**: Added `searchByTag()` — looks up tag by (orgId, lower(name)), then filters notes via EXISTS on `note_tags.tag_id`. Falls through to `searchByFts` for non-prefixed queries.
- **Commit**: `0e58a2e` on agent/search

> Stray ops notes that lived under this entry were moved to NOTES.md (seed-10k guide rebase + org-admin permission grant for the org-switcher cross-cut). They were not bug findings.

---

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

## [HIGH] [org-admin] settings actions silently discarded errors (commit 2f66565)

- **What:** Invite send, role change, and leave-org buttons appeared to do nothing in the org settings page.
- **Where:** `src/app/orgs/[orgId]/settings/page.tsx` — inline server actions `handleInvite`, `handleRoleChange`, `handleLeave`.
- **Why bad:** All three called lib functions that return `Result<T>` but ignored the return value entirely. No `redirect` or `revalidatePath` call on success, no error handling on failure — so both success and error states were silently swallowed. Invites were actually being created (visible in audit_log) but the page never re-rendered.
- **Fix:** Added `searchParams` prop, checked result in each action, added `redirect` with `?message=` on success and `?error=` on failure, flash notices rendered at top of page.
- **Fix commit:** 2f66565 (main)

---

## [MED] [deps] next@15.1.0 security vulnerabilities flagged by Railway (commit 1dc225e)

- **What:** Next.js 15.1.0 contains known security vulnerabilities.
- **Where:** `package.json` — `"next": "15.1.0"`.
- **Why bad:** Railway deployment pipeline flagged the pinned version as having CVEs. Running a vulnerable version in production exposes the app to potential exploits in the Next.js request handling layer.
- **Fix:** Upgraded to `next@15.1.11` (patch-only bump, no breaking changes, no API surface change). All pre-existing type errors confirmed unchanged after upgrade.
- **Fix commit:** 1dc225e (main)

---

## [HIGH] [deploy] Dockerfile COPY fails — missing public/ directory (commit 3972bdb)

- **What:** Docker build errors at `COPY --from=builder /app/public ./public` in the runner stage.
- **Where:** `Dockerfile` runner stage, line ~48. `public/` was never created in the repo.
- **Why bad:** Hard build failure — image cannot be produced, deployment blocked entirely.
- **Fix:** Created `public/.gitkeep` so the directory exists in the build context.
- **Fix commit:** 3972bdb (main)

## [LOW] [deploy] Invalid [[services]] table in railway.toml (commit 3972bdb)

- **What:** `[[services]]` array table is not valid Railway TOML for single-service deployments.
- **Where:** `railway.toml` lines 16-17.
- **Why bad:** Not a hard blocker but invalid config that Railway silently ignores; confusing and could cause issues on future Railway CLI versions.
- **Fix:** Removed the block — `[build]` and `[deploy]` are sufficient for a single service.
- **Fix commit:** 3972bdb (main)

## [HIGH] [deploy] NEXT_PUBLIC_* vars must be Railway build variables (operational, no code commit)

- **What:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` are baked into the Next.js bundle at build time.
- **Where:** Railway project settings — Build Variables tab.
- **Why bad:** If only set as runtime env vars, the client bundle gets `undefined` for all three — Supabase client won't initialise, auth flows break silently.
- **Fix:** Not a code fix. Must be configured in Railway: Settings → Variables → add each as a Build Variable in addition to (or instead of) a runtime variable. Dockerfile already has the correct `ARG` declarations.
- **Fix commit:** N/A — operational configuration required.

---

## [HIGH] [build] Production build blocked by 8 type/lint errors (commit 2ff2775)

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

---

## [HIGH] Notes list filters silently ignored — all notes returned regardless of selection (commit 6e227d4)

**Where:** `src/app/orgs/[orgId]/notes/page.tsx` — `notesListQuerySchema.safeParse()` call

**Found by:** User, post-deployment, 2026-04-27

**What:** HTML selects submit `""` when set to their default "All X" option. `notesListQuerySchema` uses `z.string().uuid()` for `authorId` and `z.enum(["private","org","shared"])` for `visibility` — both reject empty strings. So `safeParse` returned `success: false` on every request that had any unset filter, and the code fell back to `{ orgId, limit: 25 }` with no filters applied.

**Why bad:** Selecting any filter appeared to work (the URL updated) but the result set never changed — all notes always returned. Completely broken filtering with no error surfaced to the user.

**Fix:** Added `|| undefined` coercion before schema parse so empty strings from unset selects become `undefined`, which optional fields accept correctly.

**Fix commit:** `6e227d4` on `main`

---

## [MED] [audit] Permission denials emitted log line but no audit_log row (commit 29a9f98)

**Where:** `src/lib/auth/permissions.ts` (assertCan* helpers) and `src/lib/notes/queries.ts` (requireMemberRole)

**Found by:** User, after seeing `Error [NotesError]: You are not a member of this organisation` in the dev console and asking whether the audit_log captured it.

**What:** The `audit()` writer declared `permission.denied` as a valid action type, but no code path actually emitted it. `assertCan*` helpers had `log.warn` only; `requireMemberRole` had no logging at all. So a reviewer querying `audit_log WHERE action='permission.denied'` would always get an empty set, despite denials actively happening.

**Why bad:** Two gaps:
- Persistence: structured logs on Railway are stdout-only with no retention. The audit_log table is the durable record. Permission denials are exactly the kind of event that benefits from durable storage for security review.
- Discoverability: the action type was reserved in the AuditAction union, suggesting denials *were* persisted, which was misleading for anyone reviewing the audit setup.

**Fix:** Added `audit({ action: "permission.denied", ... })` next to the existing `log.warn` at four denial sites — three note-permission asserts and the org-membership requirement. Each audit row records the check name, the reason, and the resource so a reviewer can filter and investigate.

**Fix commit:** `29a9f98` on `main`

---

## [KNOWN] RLS bypassed on /agent/* and /mcp writes (deferred to v2)

**Where:** `src/lib/agent/sessions.ts` — `bootstrap()` and `checkpoint()` use the Drizzle `db` client. `src/app/agent/bootstrap/route.ts`, `src/app/agent/sessions/[id]/checkpoint/route.ts`, and `src/app/mcp/route.ts` do not use the Supabase server client. The MCP tool handlers in `src/lib/mcp/tools.ts` call into notes-core helpers (`searchNotes`, `listNotesForUser`, `getNoteDetailForUser`, `createNote`) which all use `db`.

**What:** Both Bearer-token paths (`/agent/*` for the hooks bridge + token CRUD, `/mcp` for the MCP server) authenticate via the `agent_tokens` table (preferred) or `MEMORY_AGENT_*` env vars (v0 fallback) and resolve to a principal `(orgId, userId, tokenId)`. There is no Supabase auth session, so reads/writes against `notes`, `note_versions`, `agent_sessions`, and `agent_tokens` go through the Drizzle `db` client (connects as `postgres` role, bypasses RLS).

**Why bad:** Per `CLAUDE.md` rule 5, RLS is the security boundary; app-level checks are for UX. On this path the boundary is the token + the explicit org-membership assertion in `requireAgentPrincipal`. If the token were to leak — or if a future contributor added a code path that read `agent_sessions` without re-asserting the org match — there's no second defence. Today the assertion is in place (`checkpoint()` verifies `note.orgId === principal.orgId` before writing) but there's no defence-in-depth.

**Why deferred:** v1 is a take-home demo. Routing through Supabase requires a programmatic service-account signin (admin API to mint a session, or a long-lived service JWT) which is a meaningful piece of auth surface to design and test in its own right. Shipping v1 with the deviation logged keeps the scope honest.

**Fix plan (v2):**
1. Provision a Supabase service-account user per deployment; store its email/password (or refresh token) alongside `MEMORY_AGENT_TOKEN`.
2. In `requireAgentPrincipal`, after the token check, sign that user in (e.g. `supabase.auth.signInWithPassword`, cached per request) and return a Supabase-authed client.
3. Replace `db` with the Supabase server client in `src/lib/agent/sessions.ts` AND in the notes-core helpers called by `src/lib/mcp/tools.ts` so RLS policies on `notes` / `note_versions` apply on both surfaces. Both lift together — same fix, two callers.
4. Add `agent_sessions` and `agent_tokens` RLS policies: `org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())` for `agent_sessions`; `agent_tokens` should additionally restrict to org admins/owners since the token list is admin-only in the UI. Today both tables are `ENABLE ROW LEVEL SECURITY` with no policies (deny-all for non-superuser) — correct only as long as the superuser-equivalent Drizzle client is the sole reader.

**Fix commit:** _(none — known issue)_

---

## [MED] Per-note timeline missing MCP/agent events (fix: feat/note-timeline-agent-events)

**Where:** `src/lib/timeline/queries.ts:41` / `src/app/orgs/[orgId]/notes/[noteId]/timeline/page.tsx:23`
**Found by:** orchestrator
**What:** `getNoteTimeline` query didn't match `mcp.tool.*` / `mcp.resource.*` audit rows (stored with `resource_type='mcp'`); per-note `EventDescription` had no branches for those action types.
**Why bad:** Agent reads/writes to a note via MCP (`get_note`, `update_note`) were invisible in that note's activity feed; any that did surface would render as raw action strings.
**Fix:** Extended OR clause to `metadata->>'noteId' = noteId`; added icon mappings and full metadata rendering for mcp/agent/search events in the per-note timeline page.
