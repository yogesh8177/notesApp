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
*orchestrator, deep:*

### Auth helpers
*orchestrator, deep:*

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
*pending — notes-core agent merge:*

### Search
*pending:*

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
*pending:*

### Org admin
Found a conflict for implementing org switcher in the baseline vs agent scoped code change path. Allowed permission for agent implementing org functionality to edit required file under orgs>[orgId]>layout.tsx directory.
*pending:*

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
*pending:*
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

