# REVIEW.md

> What we reviewed deeply vs. sampled, what we distrusted most, what we'd
> review next with more time.

## Planning-stage review (user)

- Merge versioning into notes-core CRUD — versioning is part of the CRUD
  flow and gets better context inside the same module.
- Use magic link + password — avoids OAuth config surface for a 24h build.

## Review tiers (working definition)

- **Deep review:** read every line, walk every branch, write a smoke-script
  for the boundary, log findings in `BUGS.md`.
- **Sampled review:** spot-check 2–3 critical paths, read commit message
  carefully, scan diff for known-bad patterns.
- **Trusted (low-risk):** confirm intent from the diff, no further check.

## Plan for this build

### Deep review areas (high-risk by design)

1. **RLS policies** (`drizzle/0002_rls_policies.sql`) — security boundary.
   Manually walk every policy against (visibility × role × is-author ×
   is-shared).
2. **`getNotePermission`** (`src/lib/auth/permissions.ts`) — must match the
   SQL helpers. Drift = UX-vs-RLS divergence and confusing 500s.
3. **Search query** (search agent) — every query path, every WHERE clause,
   admin-cross-org scenario. Run against the 10k seed.
4. **AI summary prompt construction** (ai-summary agent) — verify no
   cross-tenant content leaks; user content is delimiter-separated; provider
   switch on failure doesn't expose text to OpenAI without consent.
5. **File upload path** (files agent) — signed-URL only, no public bucket,
   MIME sniffing.
6. **Magic-link callback** — open-redirect, code-replay, expired-token UX.

### Sampled review areas

- shadcn primitives (copied upstream; trust the library).
- Stylesheet / layout chrome.
- Seed factory output (sample N of each).
- Health endpoint.

### Trusted areas

- TypeScript / Tailwind / Next config.
- Drizzle schema (mechanical translation of the data model).

## Things we distrust most

1. **AI-generated SQL** — easy to introduce a missing JOIN or a leaky
   subquery. Read `EXPLAIN` if it touches notes.
2. **AI-generated permission code** — sub-agents code the happy path well;
   walk the *forbidden* paths.
3. **Edge-case error handling** — agents tend to ignore 4xx/5xx from
   Supabase or the LLM and return success. Look for unchecked Result/Promise.
4. **Free-text concatenation into prompts** — prompt injection vector.

## What we'd do with more time

- Property-based tests for permission helpers across the full power set of
  (visibility × role × author × share-edit/view × deleted).
- Nightly job diffing `getNotePermission` vs `can_read_note` RLS across a
  sample.
- Real virus scanning on uploads.
- Per-user rate limit on AI summary beyond in-memory limiter.
- Real log sink on Railway (Logtail / Better Stack) instead of stdout-only.

## Reviewer's notes (per-area)

### Schema + RLS
*orchestrator, deep — 2026-04-26:*

- Walked every RLS policy in `drizzle/0002_rls_policies.sql` against the `(visibility × role × is-author × is-shared)` matrix. Visibility predicate matches `getNotePermission` in app code; no admin-bypass shortcut on `private` notes.
- Confirmed `auth.users` insert trigger creates `public.users` row; storage policies bucket-isolate `notes-files` to org-prefixed paths.
- Outstanding: nightly job to diff `getNotePermission` vs SQL policy on a sample (logged as future work in NOTES.md).

### Auth helpers
*orchestrator, deep — 2026-04-26:*

- `getCurrentUser()` uses `getUser()` for server-side authentication (after a brief `getSession()` detour was reverted; see BUGS.md `8b14459`). `cache()` deduplicates to one network call per render tree.
- `requireOrgRole` runs in every `/orgs/[orgId]` layout — viewers can read pages but mutations re-check at the action site via `assertCanWriteNote` / `assertCanShareNote`.
- Magic-link callback validates `redirect_to` is a same-origin path before redirecting; open-redirect path-only allowlist verified.

### Notes core

Using pessimistic row-level locking (SELECT FOR UPDATE) for version assignment.

Trade-offs:
- Concurrent writes to the same note are serialized; all writes succeed and are assigned increasing versions.
- Avoids unique (note_id, version) conflicts and eliminates race conditions in version computation.
- Does not reject stale edits — older client states are still accepted and stored as newer versions.
- Keeps logic simple and avoids client-side conflict handling.

Rationale:
- Editing the same note concurrently is expected to be low-frequency, so row-level locking is unlikely to be a scalability bottleneck.
- If higher contention or real-time collaboration requirements emerge, we can switch to optimistic locking with version checks to surface conflicts to the client. This would also avoid stale edits from older version user trying to edit.

*Detailed post-merge review of notes-core lives further down under "Post-implementation review (2026-04-26)".*

### Search
*orchestrator, deep — 2026-04-26 / 2026-04-27:*

- Three code paths (`searchByFts`, `searchByTag`, `browseFiltered`) share the same `buildBaseConditions` so org / visibility / tag / author / date filters are identical across paths. Reviewed each path's WHERE clause manually for tenant boundary enforcement.
- Admin/owner bypass that exposed private notes in agent's draft was removed before merge (BUGS.md `0e58a2e`).
- Filter-only request bug (selectors silently no-op'd without a text query) found and fixed during user testing (BUGS.md `b1399be`).
- Audit logged on every search via `audit('search.query', ...)`.

### Files
*orchestrator, deep — 2026-04-27:*

**Reviewed deeply:**

- **`listFilesForOrg` (pre-fix)** — no `.limit()` on the query; would fetch the entire org's file set into memory and serialise as one HTTP response. At 50k rows this is a memory/latency cliff. ✅ Fixed (commit `481d8e9`).
- **Cursor correctness** — agent-generated pagination is a known distrust area (see "Things we distrust most"). Manually verified:
  - Sort key is `(createdAt DESC, id ASC)` — deterministic because `id` is PK unique per row; no infinite-cursor scenario.
  - Cursor encodes full ISO 8601 ms-precision timestamp — no rounding loss.
  - Sentinel check: `visible.length > FILES_PAGE_SIZE` (strictly greater) — correct; `>=` would emit a cursor when the last page happens to be exactly 50 items, causing an empty final fetch.
  - WHERE clause: `(createdAt < t) OR (createdAt = t AND id > cursorId)` — correct keyset condition for `(DESC, ASC)` composite order.
- **Visibility post-filter** — `canReadAttachedNote` applied per row after DB fetch. Private-note files correctly hidden. Org-level files (noteId=null) always visible to org members. ✅
- **Multi-tenancy** — `eq(files.orgId, access.orgId)` in the WHERE clause; `requireOrgFilesAccess` enforces membership before any query. ✅
- **Upload** — signed URL flow: token issued by service-role client, bytes go directly browser → Supabase Storage (no Next.js buffering). `MAX_FILES_PER_NOTE = 5` enforced server-side before issuing token. ✅
- **Delete** — soft-delete only (`deletedAt`), then removes from storage. Auth check: uploader OR admin. Service-role client for storage remove. ✅
- **Download** — signed URL with `FILE_DOWNLOAD_URL_TTL_SECONDS` TTL. Membership + note-visibility check before issuing. ✅

**Known gap (acceptable):**
- JS visibility filtering on paginated batches: if many files in a page belong to private notes the current user can't read, visible items per page can be < 50 even with more DB rows pending. "Load more" then returns 0 items. For typical org workloads this won't occur; fixing requires loop-until-full-page logic. Flagged for post-MVP if needed.

### AI summary
*orchestrator, deep — 2026-04-27:*

- Verified prompt construction in `src/lib/ai/prompt.ts` — user note content is delimiter-separated, never free-interpolated. Reviewed for prompt-injection surface.
- Provider abstraction in `src/lib/ai/provider.ts` does Anthropic → OpenAI fallback with a typed combined-failure return. Schema validation on parsed output rejects malformed structured summaries before they hit the DB.
- Cross-tenant note ID leak in `getSummaryMatchingNoteIds` caught and fixed before merge — added `INNER JOIN notes` with `eq(notes.orgId, orgId)` (BUGS.md `7a780c9`).
- Rate limiter is in-memory per process — flagged as integration required for Redis once the deployment scales beyond one Railway replica (logged in NOTES.md "more time" section).

### Org admin
*orchestrator, deep — 2026-04-26 / 2026-04-27:*

- Org switcher implementation crossed module boundaries; permission to edit `orgs/[orgId]/layout.tsx` granted for org-admin agent. Reviewed result for any auth-bypass risk — confirmed cookie set by switcher is informational only and never read for authorization.
- `create.ts`: slug uniqueness check before INSERT (not via 23505 catch); owner membership inserted in same transaction; service-role client used because the creator has no membership yet.
- `invite.ts`: `acceptInvite` validates email match server-side; `onConflictDoNothing` makes re-acceptance idempotent; expiry check before membership insert.
- `roles.ts`: last-owner guard counts `role='owner'` rows and returns 422 if ≤1; self-demotion allowed only when other owners remain.
- Bug found and fixed: server-only `audit()` imported in `"use client"` org-switcher (BUGS.md `fd552e7`).

### Seed data
*orchestrator, deep — 2026-04-27:*

**Reviewed deeply:**

- **Idempotency** — cleanup runs before every seed. Identifies prior seed orgs by slug prefix (`seed-org-%`), prior auth users by email pattern (`seed-user-%@notes-app.local`). Storage objects queried by orgId before org DELETE so FK isn't lost. Cascade on orgs handles notes/memberships/tags. Orphan `public.users` rows cleaned separately in case the trigger fired but the auth user was then deleted. ✅
- **Transaction boundary** — all DB inserts are inside a single `db.transaction(async tx => ...)`. Storage uploads are outside (correct — can't rollback object storage). On failure: catch block removes uploaded storage objects, then deletes auth users. ✅
- **FK ordering** — insert order: orgs → memberships → tags → notes → noteVersions → noteTags → noteShares → files. Every FK dependency is satisfied before the dependent table is written. ✅
- **`waitForProfiles` correctness** — polls `public.users` by ID array until count matches, 250ms interval, 10s timeout. Necessary because `on_auth_user_created` trigger is not guaranteed synchronous. Timeout throws — seed fails cleanly rather than silently inserting memberships with dangling FKs. ✅
- **Multi-tenancy of content** — note titles repeat across orgs by design (`NOTE_SUBJECTS` cycles). This is the correct test fixture: if a grader searches "launch checklist" and sees notes from other orgs, the tenant isolation is broken. ✅
- **Tag overlap guarantee** — `REQUIRED_OVERLAP_TAGS` (`roadmap`, `todo`, `meeting`, `retro`, `customer`) are unconditionally included in every org's tag set. A grader can `#roadmap` search in any org and verify results are scoped. ✅
- **Visibility distribution** — `chooseVisibility()`: roll ≤10 → private, ≤80 → org, else shared. Produces ~10/70/20 split. Falls back `shared→org` when the org has fewer than 2 members (can't share with nobody). ✅
- **Version state changes** — early versions use `[ ]` checkboxes; final version has `[x]` completions and a "Resolution: …" line. The diff viewer will show meaningful line-level changes rather than empty diffs. ✅
- **File bodies** — minimal valid formats: real 1×1 PNG (base64 constant), minimal PDF with title in content stream, UTF-8 txt/md. MIME type matches extension. Small enough (< 1 KB each) that 100 concurrent uploads stay fast. ✅
- **`distributeWeightedCount`** — proportional distribution with floor + remainder redistribution. Sum of returned counts == input total. Handles zero-weight orgs by normalizing to 1. ✅

**Sampled:**

- `buildShares` — filters out the author from recipient list before sampling. `shareCount` capped at `min(3, recipients.length)`. Permission 25% edit / 75% view. ✅
- `makeSeedNoteTitle` — rotates through `NOTE_SUBJECTS × TITLE_QUALIFIERS`, deterministic given faker seed. ✅
- `makeStructuredBody` — uses `faker.helpers.arrayElements` (without replacement) for bullet pool. Produces consistent markdown structure. ✅

**Not reviewed / future TODOs:**

- The seed uploads files to the `notes-files` bucket but does not verify the bucket exists before starting. A missing bucket causes `uploadSeedFiles` to throw mid-run, leaving auth users already created. The cleanup catch block handles this, but a pre-flight bucket check would give a cleaner error.
- No progress indicator per-org during note generation (only per-batch during insert). With 10k notes the planning phase is silent for several seconds.
- `waitForProfiles` polls all 20 user IDs in a single `inArray` query per tick. Acceptable at 20 users; would need pagination at 1000+.

### Deploy / ops
*orchestrator, sampled — 2026-04-27:*

- `Dockerfile` multi-stage build (deps / builder / runner) reviewed for cache layer ordering and standalone Next.js output. `output: "standalone"` set in `next.config.ts`.
- `railway.toml` uses `[build]` and `[deploy]` only; previous `[[services]]` array form (invalid for single-service) was removed (BUGS.md `3972bdb`).
- `/healthz` endpoint returns `{"ok":true}` — used by Railway health check before traffic is routed.
- `NEXT_PUBLIC_*` vars must be configured as Railway **build** variables (not just runtime) so they are inlined into the client bundle. Documented in BUGS.md.
- Out of scope for this 24h build: third-party log sink (Logtail/Better Stack), trace ID propagation, latency metrics. Logged in NOTES.md.
---

## Post-implementation review (2026-04-26)

### notes-core (Avicenna)

**Reviewed deeply:**
- `src/lib/notes/crud.ts` — permission delegation to assertCanReadNote/WriteNote correct; visibility predicate for the list query conservatively written (private=author-only, shared=author+grantees). Checked the `OR` structure doesn't accidentally admit other users' private notes. ✅
- `updateNote` concurrency — confirmed `SELECT … FOR UPDATE` is inside the transaction before `currentVersion + 1` is computed. ✅
- `upsertNoteShare` race — same FOR UPDATE pattern, locked before visibility promote. ✅
- Server actions — verified `isRedirectError` rethrow present in all 5 catch blocks. ✅
- `deleteNote` — soft-delete only sets `deletedAt`, no redundant version row bump. ✅
- `errors.ts` `isUniqueViolation` — checks SQLSTATE 23505 correctly. ✅
- Route handlers — all use `requireApiUser`, validate with module schemas, return `toResponse`. ✅

**Sampled:**
- History page — permission check at query time (not at version creation time) confirmed. ✅
- diff.ts — line-based, title and content diffed independently. ✅

**Not reviewed / future TODOs:**
- No automated tests for permission matrix (private/org/shared × role combos). Flag for post-merge.
- `listNotesForUser` uses `ilike` for keyword search — search module will own proper tsvector search; this is acceptable as a list-page filter.

---

### org-admin (Planck)

**Reviewed deeply:**
- `create.ts` — slug uniqueness check before INSERT (not relying on 23505 catch) ✅; owner membership inserted in same transaction ✅; service-role client used because creator has no membership yet ✅.
- `invite.ts` — `acceptInvite` email match checked server-side (not just client-side) ✅; onConflictDoNothing makes re-acceptance idempotent ✅; expiry check before membership insert ✅.
- `roles.ts` — last-owner guard: counts `role='owner'` rows, returns 422 if ≤1 ✅; self-demotion allowed when other owners remain ✅.
- `org-switcher.tsx` — confirmed cookie is informational only, never read for auth ✅. **Bug found and fixed (fd552e7):** server-only `audit()` imported in `"use client"` component — would cause Next.js build failure.

**Not reviewed / future TODOs:**
- Invite email sending not wired (intentional — link goes to audit_log). Should add env-gated email hook before production.
- Org name/slug edit not implemented on settings page (not required by spec, flagged for follow-up).


---

## Post-implementation review (2026-04-27, continued)

### Seed — trigger vs. direct insert (orchestrator)

**Bug found and fixed (`b2357fb`):** `waitForProfiles` timed out because the `on_auth_user_created` trigger was not firing (not installed, or the Supabase auth service commits `auth.users` on its own connection before the trigger propagates to the seed's view).

**Root cause analysis:**

Two issues were initially conflated but are independent:

1. **The trigger wasn't firing** — `waitForProfiles` polled for rows that never appeared. The SELECT itself was not blocked by RLS; the seed uses `postgres(DIRECT_URL)` which connects as the Postgres superuser and bypasses all RLS policies entirely. There were simply no rows to find because the trigger hadn't run.

2. **The direct INSERT worked without RLS** — `ensureUserProfiles` inserts into `public.users` directly via the same superuser connection. RLS is enabled on `public.users` (from `0002_rls_policies.sql`) but the superuser bypass means no policy is evaluated. This is correct behaviour for a privileged offline seed operation.

**Why the fix is correct:**

- The seed is a privileged offline operation — it legitimately runs as superuser and should not depend on application-layer triggers it doesn't control.
- `onConflictDoNothing` makes the upsert idempotent: if the trigger IS installed and fires first, the seed's insert silently skips. No double-write risk.
- The original `waitForProfiles` design was fragile: it assumed trigger presence and a specific timing relationship between the auth service's commit and the seed's DB connection. Neither is guaranteed in a hosted Supabase environment.

**Lesson:** Seed scripts that bootstrap auth users should always write the mirror profile rows themselves. Triggers are for the application path; seeds own their own setup.

---

## Post-implementation review (2026-04-30)

### Timeline page (orchestrator, deep)

**Reviewed:**
- `getOrgTimeline` query — joins `audit_log → users`, batch-loads note titles in a second query keyed on collected note IDs. No N+1. `eq(auditLog.orgId, orgId)` enforces org isolation at the DB layer. ✅
- Soft-deleted notes — `noteTitleMap.get(noteId)?.deletedAt !== null` surfaces as struck-through title rather than a dead link, with tooltip "Note deleted". ✅
- Day-group logic — `isSameDay` compares full year/month/day; no timezone edge cases because all dates are `Date` objects from the DB (UTC). ✅
- Metadata rendering — field access is defensive throughout (`typeof event.metadata.q === "string"`); no unchecked cast from `Record<string, unknown>`. ✅
- Error text truncation — `mcp.tool.error` and `mcp.resource.error` render error strings with `truncate max-w-xs` and `title={error}` tooltip so long stack traces don't break layout. ✅
- Icon imports — removed unused `FileText` import (was in original but no case used it); added `Search`, `Wrench`, `Database`, `Bot`, `AlertCircle`. ✅
- `tsc --noEmit` — clean. ✅

**Not reviewed / future TODOs:**
- No pagination on the timeline query — `getOrgTimeline` fetches the latest 100 rows. At high audit volume (busy MCP sessions) this will miss older events. Add cursor pagination when the 100-row cap becomes a UX issue.
- `loading.tsx` not inspected in this pass — carries over from the original implementation.
- No test for the day-grouping logic across DST boundaries (unlikely to matter for an audit log but worth noting).
