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
- `deploy-ops` — pending; branch/worktree reserved at `/private/tmp/notes-app-deploy-ops` on `agent/deploy-ops`; worker launch deferred by the 6-agent runtime cap.

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
**What's pending:** Notes-core must call `getSummaryMatchingNoteIds` in `listNotesForUser` to include summary text in search. Exact integration snippet in NOTES.md.

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
- `session.ts`: `getUser()` → `getSession()` (eliminates one ~150–300ms Supabase network call per page load)
- `db/client.ts`: `max: 1 → 5` in dev (allows `Promise.all` DB queries to run in parallel)

**What was right:** Correctly identified the double auth call as root cause. `getSession()` is safe here because the middleware's `getUser()` on the same request already validated and refreshed the JWT.

**What to watch:** If Supabase ever adds server-side session revocation that needs to be enforced immediately (e.g. admin force-logout), `getSession()` won't catch revoked tokens mid-JWT-lifetime. For a notes app this is an acceptable tradeoff; revisit if auth requirements change.

## 2026-04-27 — Files-in-notes + summary features (orchestrator)

**Parallelization attempted:** dispatched ai-summary and files agents in parallel. All three sub-agent invocations failed — environment denies Bash/Read/Write/Edit tool access to spawned agents. Orchestrator absorbed both tasks.

### Files feature
Read: `index.ts`, `validation.ts`, `route.ts`, `files-client.tsx`, `types.ts`, `permissions.ts`, `errors.ts`. Identified upload flow (signed URL → Supabase Storage direct upload → metadata insert). Added cap check, note-scoped list endpoint, and `NoteFileUploader` component. No sub-agent.

### AI Summary feature
Read: `summary/page.tsx` — found it already fully built. Gap was navigation to it. Read schema to understand JSONB `structured` field. Created tab layout + JSONB search helper. No sub-agent.

**What went wrong:** Sub-agents launched as `brand-voice:*` and unnamed agent types first, then re-dispatched as `general-purpose`. All denied tool access. Root cause: environment permission mode doesn't extend to spawned agents.

**What to log for future:** Always use `general-purpose` subagent type for implementation tasks. If they still fail on tool access, do the work inline.
