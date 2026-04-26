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
*pending:*

### AI summary
*pending:*

### Org admin
Found a conflict for implementing org switcher in the baseline vs agent scoped code change path. Allowed permission for agent implementing org functionality to edit required file under orgs>[orgId]>layout.tsx directory.
*pending:*

### Seed data
*pending:*

### Deploy / ops
*pending:*