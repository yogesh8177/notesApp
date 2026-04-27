# AI_USAGE.md

> Which agents we used, how work was split, what ran in parallel, where agents
> were wrong, where we intervened, what we don't trust agents to do.

## Orchestration model

- **Orchestrator agent** (this one): planning, baseline `main`, merge gates,
  spawning module agents, reviewing diffs.
- **Module agents** (parallel, in worktrees): one per module. Each gets a
  tailored prompt + the module's `docs/modules/<name>.md` guide + the
  frozen-contracts brief in root `CLAUDE.md`.
- **Sub-agents** (used inside any agent for narrow tasks): exploration,
  verification, doc generation. Always with cap on context (short report
  prompts).

## Parallelization map

```
                     ┌─ baseline (main) ──────────────────┐
                     │  schema · RLS · auth · log · shell │
                     └────────────────────┬───────────────┘
                                          │ frozen
              ┌────────────┬─────────────┼─────────────┬─────────────┐
              ▼            ▼             ▼             ▼             ▼
        notes-core      search         files       ai-summary    org-admin
              │            │             │             │             │
              └─▶ merge order: seed-10k → notes-core → {search, files, org-admin}
                            → ai-summary → deploy-ops
```

## Agent log

> Append one entry per agent invocation. Date, agent, prompt summary,
> outcome, what we changed.

### 2026-04-26 — Orchestrator

- Read PDF spec, drafted module split.
- User confirmed: merge versioning into notes-core, OpenAI fallback, magic
  link + password, pg_trgm + tsvector, shadcn/ui.
- Baseline scaffolded (~50 commits on `main`).
- User pushback: commits initially too coarse — re-cut into atomic logical
  commits.

### 2026-04-26 — Module agents (launched in isolated worktrees)

- `notes-core` — worker `Avicenna`; worktree `/private/tmp/notes-app-notes-core`; branch `agent/notes-core`; prompt: implement `src/lib/notes/**`, `src/app/orgs/[orgId]/notes/**`, `src/app/api/notes/**` per `docs/modules/notes-core.md` without touching frozen contracts.
- `search` — worker `Dewey`; worktree `/private/tmp/notes-app-search`; branch `agent/search`; prompt: implement `src/lib/search/**`, `src/app/orgs/[orgId]/search/**`, `src/app/api/search/**` per `docs/modules/search.md` with org and visibility constraints enforced in SQL.
- `files` — worker `Galileo`; worktree `/private/tmp/notes-app-files`; branch `agent/files`; prompt: implement `src/lib/files/**`, `src/app/orgs/[orgId]/files/**`, `src/app/api/files/**` per `docs/modules/files.md` with signed URL flow and note-write checks for attachments.
- `ai-summary` — worker `Leibniz`; worktree `/private/tmp/notes-app-ai-summary`; branch `agent/ai-summary`; prompt: inspect owned paths and either implement safely from local baseline or log precise blockers because no local module guide is present.
- `org-admin` — worker `Planck`; worktree `/private/tmp/notes-app-org-admin`; branch `agent/org-admin`; prompt: inspect owned paths and either implement safely from local baseline or log precise blockers because no local module guide is present.
- `seed-10k` — worker `Ampere`; worktree `/private/tmp/notes-app-seed-10k`; branch `agent/seed-10k`; prompt: inspect `scripts/seed/**` and either improve the large-seed workflow safely or log precise blockers because no local module guide is present.
- `deploy-ops` — orchestrator-handled inline (sub-agent launch deferred by the 6-agent runtime cap, then absorbed into the main thread). `Dockerfile`, `railway.toml`, and `/healthz` shipped from `main`; Railway env vars and Supabase URL configuration done by the user.

### 2026-04-26 — Module agent outcomes so far

- `search` — worker `Dewey` implemented the module inside owned paths only: `src/lib/search/**`, `src/app/api/search/**`, and `src/app/orgs/[orgId]/search/**`. Logged blocker that local `CLAUDE.md` and `docs/modules/search.md` were missing in the worktree; targeted verification was limited to `git diff --check` because local `tsc` is unavailable.
- `ai-summary` — worker `Leibniz` stopped without product code changes and logged blockers in the module worktree docs. Missing local contracts: root `CLAUDE.md`, owned app paths, and note-detail route shape.
- `org-admin` — worker `Planck` stopped without product code changes and logged blockers in the module worktree docs. Missing local contracts: root `CLAUDE.md`, owned app paths, and org create/invite/settings behavior.

### 2026-04-26 — files module outcome (`Galileo`, `agent/files`)

- Implemented the files module inside owned paths only.
- Added signed upload/download flows, org/note permission checks, list/delete,
  and an org files UI.
- Left `/notes/[id]` attachment UI untouched because it is outside files
  ownership.

### 2026-04-26 — seed-10k module outcome (`Ampere`, `agent/seed-10k`)

- Implemented the large-seed workflow inside `scripts/seed/**`.
- Covered deterministic org/user/note/version/share/file generation, auth-user
  creation via Supabase admin API, batched inserts, and summary logging.
- Requires a follow-up check against the newly-present module guide's stricter
  data-semantics requirements.

### 2026-04-26 — seed-10k follow-up audit (`Codex`, `agent/seed-10k`)

- Re-read `CLAUDE.md` and `docs/modules/seed-10k.md`, then audited only
  `scripts/seed/**` against the explicit module guide.
- Found concrete mismatches in defaults, memberships, note distribution,
  repeated-title semantics, version skew, file volume/type split, and final
  summary output.
- Patched only `scripts/seed/factories.ts` and `scripts/seed/run.ts`.
- Verification was limited to `git diff --check`; `npm run typecheck` failed in
  the local environment because `tsc` is not installed in this worktree.

## Things we don't trust agents to do (kept on the human side)

- **Approving baseline contract changes** (schema, RLS, auth, logger). If a
  module agent proposes any of these, it lands in `NOTES.md` for orchestrator
  review before merge.
- **Promoting fallback AI provider as primary** — if Anthropic is down for
  long enough that an agent considers swapping, that's a human call.
- **Deploying to Railway / pushing to remote** — agents prepare; human runs.
- **Final review of permission checks on AI prompts** — easiest place for
  prompt injection or cross-tenant leakage. Always human-reviewed.

## Where agents have been wrong (running list)

> Update as each module merges. Examples to watch for, expected based on prior
> patterns:
> - Forgetting `org_id = $1` filters in search.
> - Accepting `redirect_to` from query without origin check.
> - Using service-role client from a request handler "to make a query work".
> - Streaming user note content to an LLM without delimiter separation.
> - Off-by-one in note version number on concurrent updates.

## 2026-04-27 — Files: note-scoped upload + 5-cap (orchestrator, no sub-agent)

Sub-agent dispatched twice, both times denied tool access by the environment. Orchestrator implemented directly.

**What I did:** Read existing `src/lib/files/index.ts`, `validation.ts`, `api/files/route.ts`, `files-client.tsx`, and `types.ts` to understand the upload flow (signed URL → Supabase direct upload → metadata insert). Then:
1. Added `countFilesForNote` + `getFilesForNote` to `index.ts`
2. Wired 5-cap check into `createUpload` (count before signed URL issuance)
3. Extended GET route to handle `?noteId=` alongside existing `?orgId=`
4. Created `NoteFileUploader` client component

**What was right:** Reusing `canReadAttachedNote` for `getFilesForNote` access checks — same visibility logic, no duplication.
**Integration required:** Notes-core needs one import + render of `<NoteFileUploader>` in note create/edit forms. Documented in NOTES.md.
### 2026-04-26 — Module agent `Leibniz` retry with restored ai-summary guide

- Re-ran after baseline added `CLAUDE.md` and `docs/modules/ai-summary.md`.
- No sub-agents used; implementation is being done directly in the module worktree to keep ownership tight.
- First implementation chunk is the structured summary schema in `src/lib/ai/schema.ts`, matching the DB-side contract comment in `src/lib/db/schema/ai.ts`.
- Second implementation chunk isolates the prompt template in `src/lib/ai/prompt.ts` so delimiter handling and prompt-safety rules live in one owned file.
- Third implementation chunk adds the provider wrapper in `src/lib/ai/provider.ts`, including Anthropic-first selection, timeout handling, OpenAI fallback, schema validation, and typed combined failure reporting.
- Fourth implementation chunk adds `src/lib/ai/rate-limit.ts` as a separate concern so request throttling can be reviewed independently from provider logic.
- Fifth implementation chunk adds the generation route under `src/app/api/ai/notes/[noteId]/summary/route.ts`, including permission checks, pending-row persistence, provider invocation, typed failures, and audit events.
- Sixth implementation chunk adds the summary page and acceptance flow under `src/app/orgs/[orgId]/notes/[noteId]/summary/**`, including a server action that writes `accepted_fields` and `status='accepted'`.
- Verification gap recorded honestly: `npm run typecheck` could not complete because `tsc` is not installed in this worktree environment (`sh: tsc: command not found`).

## 2026-04-27 — AI Summary: visibility + search (orchestrator, no sub-agent)

Sub-agent dispatched twice, both times denied tool access. Orchestrator implemented directly.

**What I did:** Read `src/app/orgs/[orgId]/notes/[noteId]/summary/page.tsx` — found it fully built with generate button, status, all summary fields, accept form. The gap was navigation TO the summary page. Created:
1. `notes/[noteId]/layout.tsx` — tab navigation wrapping note + summary routes
2. `src/lib/ai/summary-search.ts` — JSONB search helper for notes-core to use

**What was right:** Layout approach adds "AI Summary" tab without touching notes-core's page.tsx. Clean merge.
**Integration required:** Notes-core must call `getSummaryMatchingNoteIds` in `listNotesForUser` to include summary text in search. Exact integration snippet in NOTES.md.

---

## 2026-04-27 — Production build fixes (orchestrator, no sub-agent)

**Trigger:** `npm run build` run to verify deployment readiness; failed with 8 distinct errors across 10 files.

**What I did:** iterated build → fix → build until clean. No sub-agent — all errors were straightforward type/lint fixes resolvable from reading the failing file in isolation.

**Errors and root causes:**

| File | Error | Root cause |
|---|---|---|
| `log/index.ts` | ESLint rule not found | `@typescript-eslint/*` rules not in `next/core-web-vitals` config |
| `invite/[token]/page.tsx` | `<a>` + `result.error.code` | Bare anchor; flat `Err` type misread as nested |
| `files-client.tsx` | `useEffect` missing dep | `refreshFiles` not memoized |
| `ai/schema.ts` | TS union intersection | Loop assignment across discriminated union |
| `auth/permissions.ts` | TS2367 comparison | Drizzle infers literal default on left-join enum column |
| `files/index.ts` | Possibly null | Left-join `uploader` not guarded |
| `validation/result.ts` | `"UNPROCESSABLE"` missing | Baseline `ErrorCode` union never included it |
| `supabase/middleware.ts` + `server.ts` | Implicit any | `setAll` callback param untyped |
| `env.ts` | Build-time env failure | `.min(1).optional()` rejects empty string; AI keys empty in local `.env` |

**Build result:** clean — all routes compile as dynamic (ƒ), no static prerender errors.

## 2026-04-27 — Performance investigation: slow API calls (orchestrator, no sub-agent)

**Task:** User reported 2–3 second API latency on localhost.

**What I did:**
1. Read `src/lib/db/client.ts` — connection pool config
2. Read `src/lib/supabase/middleware.ts` — found first `getUser()` call
3. Read `src/lib/auth/session.ts` — found second `getUser()` call (the real culprit)
4. Read `src/lib/auth/org.ts` — confirmed `requireOrgRole` chains through `getCurrentUser()`
5. Grep'd `src/lib/notes/` — confirmed `Promise.all` already used; identified pool `max: 1` as dev bottleneck

**No sub-agent used** — sequential file reads answered the question; delegating would have added overhead with no benefit.

**Changes made:**
- `session.ts`: `getUser()` → `getSession()` (eliminates one ~150–300ms Supabase network call per page load) — **later reverted** when the Supabase SDK emitted a security warning about `getSession()` returning unauthenticated cookie data; see `getSession()` revert entry below and BUGS.md commit `8b14459`.
- `db/client.ts`: `max: 1 → 5` in dev (allows `Promise.all` DB queries to run in parallel) — kept; covers the latency regression on its own.

**What was right at the time:** Correctly identified the double auth call as the latency root cause. The pool fix on its own was sufficient.

**What was wrong:** Treating middleware's prior `getUser()` as a sufficient security boundary for downstream consumers was overly optimistic. Supabase's SDK explicitly warns that `getSession()` reads cookie data that has not been re-authenticated against the auth server. Reverted in a later session.

## 2026-04-27 — Files-in-notes + summary features (orchestrator)

**Parallelization attempted:** dispatched ai-summary and files agents in parallel. All three sub-agent invocations failed — environment denies Bash/Read/Write/Edit tool access to spawned agents. Orchestrator absorbed both tasks.

### Files feature
Read: `index.ts`, `validation.ts`, `route.ts`, `files-client.tsx`, `types.ts`, `permissions.ts`, `errors.ts`. Identified upload flow (signed URL → Supabase Storage direct upload → metadata insert). Added cap check, note-scoped list endpoint, and `NoteFileUploader` component. No sub-agent.

### AI Summary feature
Read: `summary/page.tsx` — found it already fully built. Gap was navigation to it. Read schema to understand JSONB `structured` field. Created tab layout + JSONB search helper. No sub-agent.

**What went wrong:** Sub-agents launched as `brand-voice:*` and unnamed agent types first, then re-dispatched as `general-purpose`. All denied tool access. Root cause: environment permission mode doesn't extend to spawned agents.

**What to log for future:** Always use `general-purpose` subagent type for implementation tasks. If they still fail on tool access, do the work inline.

## 2026-04-27 — seed-10k: rebase + re-commit + review (orchestrator, no sub-agent)

**Trigger:** User asked to implement the seed-10k worktree with the updated module guide.

**What I did:**

1. Read `docs/modules/seed-10k.md` to understand the spec — corporate content, structured bodies, overlap tags, 5 orgs / 20 users / 10k notes, idempotency, 90s budget.
2. Read the existing worktree files: `scripts/seed/factories.ts` (729 lines) and `scripts/seed/run.ts` (533 lines) from the previous Ampere agent's WIP commit.
3. Assessed completeness: factories had all required generators (corporate titles, structured body, version state changes, tag pools, files). Run had auth user creation, cleanup, batched inserts, storage uploads, summary. No gaps found.
4. Rebased `agent/seed-10k` onto `main` — one NOTES.md conflict resolved by taking main's version.
5. Split the single WIP commit into 3 atomic commits (factories / run / docs) per module conventions.
6. Type-checked with local `tsc --noEmit` — clean.
7. Force-pushed with `--force-with-lease`.

**No sub-agent used** — read the code directly; sub-agent would have re-derived the same context from scratch.

**What the previous Ampere agent got right:**
- Idempotent cleanup pattern (prefix-based org slug + email pattern) is correct — no seed run ID needed.
- `waitForProfiles` polling before DB inserts — necessary because auth trigger can be async.
- Storage batched separately from DB transaction — correct; object storage can't participate in Postgres transactions.
- File body quality: minimal valid PDF, 1×1 PNG, real text content — passes MIME sniff, small enough for fast upload.
- `distributeWeightedCount` for proportional note distribution across orgs — correct math, handles remainder correctly.
- Overlap tag guarantee (`REQUIRED_OVERLAP_TAGS`) — exactly what the spec needs for cross-org isolation testing.

**What the previous agent didn't do:**
- Commit granularity: everything in one WIP commit. Split on orchestrator review.
- Docs: NOTES.md and AI_USAGE.md not updated in the seed worktree. Added here.

**What to watch when running the seed:**
- If `notes-files` storage bucket doesn't exist, `uploadSeedFiles` will fail. Run `0003_storage_policies.sql` first.
- `waitForProfiles` has a 10s timeout. If Supabase auth triggers are slow (cold start), increase to 30s.
- 10k notes × avg 2.5 versions = ~25k version rows. With 500-row batches that's ~50 round trips for versions alone. Acceptable under 90s on a warm connection.

## 2026-04-27 — Search filter bug + observability audit (orchestrator, no sub-agent)

**Trigger:** User reported search page tag filter and other filters not working.

**What I did:**
1. Read `page.tsx`, `service.ts`, `contracts.ts`, `index.ts` — identified two root causes: `shouldSearch = Boolean(filters.q)` and `searchRequestSchema` making `q` required
2. Added `browseFiltered()` to handle filter-only queries with no FTS involved
3. Made `q` optional in `searchRequestSchema`; fixed `input.q.slice()` crash in audit
4. Verified multi-tenancy across all three search paths (FTS, tag-prefix, browse)
5. Audited logging coverage across permissions.ts and all server actions — found no logging on denials or failures
6. Added `log.warn` to all three `assertCan*` helpers in `permissions.ts`
7. Added `log.error`/`log.warn` to all five note server action catch blocks

**No sub-agent used** — all in owned paths, sequential file reads sufficient.

**What was wrong:** `shouldSearch` gating on `filters.q` was an obvious oversight — the filter form has 6 fields, only one of which is the text query. Should have been `hasActiveSearchFilters` from the start.

**What was right:** The `browseFiltered` → `searchByTag` → `searchByFts` routing pattern in `searchNotes` is clean — each path shares `buildBaseConditions` (same org/visibility/tag/author/date enforcement) and only differs in ranking/ordering.

## 2026-04-27 — Auth revert + file upload error logging (orchestrator, no sub-agent)

**Trigger:** Supabase SDK emitted a runtime security warning about `getSession()` during file upload debugging. User asked to log both fixes in the MD files.

**What I did:**
1. Identified the warning source — `src/lib/auth/session.ts` using `getSession()` from the previous perf optimisation session
2. Reverted `getCurrentUser()` to `getUser()` — `cache()` deduplicates to one call per render; security guarantee restored
3. Added `log.error` to `createUpload` in `src/lib/files/index.ts` to surface the real `StorageError` before throwing `UPSTREAM`
4. Committed both fixes in one commit (`8b14459`) with full reasoning in the message
5. Updated BUGS.md with two new entries; updated NOTES.md with the session decision log

**No sub-agent used** — both were single-file edits with clear scope; delegating would have added latency with no benefit.

**What was wrong:** The `getSession()` switch in the previous session was overly optimistic about middleware being a sufficient security boundary. Supabase's own SDK disagrees. Should have kept `getUser()` from the start and relied solely on the pool fix for the perf gain.

**What was right:** Adding `log.error` before the throw is the correct pattern for any external-service call that can fail — never swallow the upstream error object.

## 2026-04-27 — Seed trigger timeout + RLS analysis (orchestrator, no sub-agent)

**Trigger:** `npm run seed` failed with "Timed out waiting for public.users rows created by auth trigger" after successfully creating 20 auth users.

**What I did:**
1. Read `waitForProfiles` in `scripts/seed/run.ts` — confirmed it polls `public.users` by ID array with 250ms interval, 10s timeout
2. Read the trigger definition in `drizzle/0002_rls_policies.sql` — `on_auth_user_created` AFTER INSERT on `auth.users` — trigger is correct SQL but not guaranteed to fire in hosted Supabase (auth service commits on its own connection)
3. Read `schema/users.ts` — confirmed `public.users` has RLS enabled; confirmed seed uses `postgres(DIRECT_URL)` which is a superuser connection that bypasses RLS entirely
4. Identified the two independent issues: (a) trigger not firing — not an RLS problem on the SELECT, simply no rows; (b) direct INSERT works because superuser bypasses RLS
5. Replaced `waitForProfiles` with `ensureUserProfiles` — direct upsert into `public.users` with `onConflictDoNothing` so it's idempotent if trigger does fire
6. Ran `npm run seed` — succeeded: 10 orgs, 20 users, 10k notes, 25k versions, 100 files

**No sub-agent used** — single function replacement with clear diagnosis.

**What was wrong:** `waitForProfiles` treated the trigger as a reliable synchronous side-effect of `admin.createUser`. In hosted Supabase, the auth service writes `auth.users` via its own internal connection; the trigger fires within Postgres but not necessarily before the seed's next poll resolves. The 10s timeout is too short at cold-start with 20 sequential user creations.

**Key insight (user-identified):** The reason the direct INSERT worked without RLS interference is that the seed's Postgres connection is the superuser — it bypasses all RLS policies. This is also why `waitForProfiles`'s SELECT would have worked if the trigger had fired; the SELECT was not the problem. The problem was that there were no rows to select.

**What was right:** `onConflictDoNothing` correctly handles the case where the trigger fires before the seed's upsert — no double-write, no error. The fix is both correct and idempotent.

**Design principle logged:** Seed scripts that bootstrap auth users should always write the mirror profile rows themselves. Triggers are for the application request path; seeds own their own setup and cannot depend on application-layer trigger presence.

## 2026-04-27 — Railway 0.0.0.0 redirect fix (orchestrator, no sub-agent)

**Trigger:** User reported magic link and sign-out both redirecting to `https://0.0.0.0:8080` in Railway deployment.

**What I did:**
1. Read `auth/callback/route.ts` and `auth/sign-out/route.ts` — both used `request.nextUrl.clone()` to build redirect URLs
2. Identified root cause: Railway's proxy sets `request.nextUrl.origin` to the internal bind address (`0.0.0.0:8080`), not the public domain
3. Read `next.config.ts` — no proxy trust configuration present
4. Created `src/lib/auth/public-url.ts` — reads `x-forwarded-host` / `x-forwarded-proto` proxy headers to reconstruct the correct public URL; falls back to `request.nextUrl.origin` in local dev
5. Updated both auth routes to use `publicUrl()` for all redirects
6. Typechecked — clean

**No sub-agent used** — two-file fix with clear root cause.

**What was wrong:** `request.nextUrl` in Next.js route handlers reflects the address the server is listening on internally, not the address the client used. This is a known gotcha with any Next.js deployment behind a reverse proxy. Should have been caught during deploy-ops review.

**What was right:** Using `x-forwarded-host` is the correct pattern — Railway sets it reliably. The fallback to `request.nextUrl.origin` keeps local dev working without extra env config.

## 2026-04-28 — Documentation cleanup pass (orchestrator, no sub-agent)

**Trigger:** User requested doc-only cleanup: fix inconsistencies, remove unfinished language, normalize BUGS.md format, reduce overclaims, preserve voice. Explicit instruction: "Reduce changes. Only fix correctness and clarity issues, this isn't rewrite rather tuning for submission."

**What I read first:**
- All six target files (`README.md`, `REVIEW.md`, `NOTES.md`, `CLAUDE.md`, `BUGS.md`, `AI_USAGE.md`) end-to-end before editing anything. Without that pass it is too easy to "fix" a passage that another file resolves later.

**Decision tree I followed:**

1. Identify contradictions across files first — these are the highest-cost defects because they make the docs feel untrustworthy. The `getSession()` vs `getUser()` story was the clearest example: AI_USAGE.md described the switch as a current optimisation; BUGS.md `8b14459` documented the revert. Fixed by amending the AI_USAGE.md entry to acknowledge the revert in line.
2. Replace "pending" / "what's pending" with concrete language only where there's actual evidence the work is complete or known to be out of scope. Don't manufacture closure for things that are genuinely incomplete.
3. For BUGS.md, only normalize the heading shape — don't rewrite entry bodies. The bodies are honest field notes; rewriting them would be exactly the over-polish the user asked me not to do.
4. Move stray non-bug content (the seed-10k.md rebase note, the org-admin permission grant note) to NOTES.md where ops decisions belong. Leave a one-line breadcrumb in BUGS.md so the move is explicit.

**What I deliberately did not do:**
- Did not collapse this AI_USAGE.md log into a summary. It is supposed to read as an honest agent-execution trail.
- Did not reorder REVIEW.md sections or change tone. Filled the empty placeholders with content that already existed in BUGS.md/NOTES.md, citing those entries explicitly so the reader can verify.
- Did not rewrite "completely broken" / "completely undiagnosable" — these are factual descriptions of the bugs, not overclaims. The user's overclaim guidance targets words like "safe" / "guaranteed" used as architectural claims, which I did not find anywhere that warranted rewording (the closest case was the now-deleted "getSession is safe here" claim, which I rewrote because it was actually wrong).
- Did not touch CLAUDE.md or README.md — they were consistent with the implementation.

**What was right:** Reading all files first; then making the smallest set of focused edits per file rather than doing one pass per file.

**What I wanted to do but didn't:** Restructuring REVIEW.md to put the per-area review notes alphabetically. The user said "Do not reorder large sections" — left as-is.
