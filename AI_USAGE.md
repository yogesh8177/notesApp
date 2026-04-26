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
- `deploy-ops` — worker `Harvey`; worktree `/private/tmp/notes-app-deploy-ops`; branch `agent/deploy-ops`; prompt: inspect owned paths and implement readiness/deployment work only inside deploy-ops surfaces.

### 2026-04-26 — Module agent outcomes so far

- `search` — worker `Dewey` implemented the module inside owned paths only: `src/lib/search/**`, `src/app/api/search/**`, and `src/app/orgs/[orgId]/search/**`. Logged blocker that local `CLAUDE.md` and `docs/modules/search.md` were missing in the worktree; targeted verification was limited to `git diff --check` because local `tsc` is unavailable.
- `files` — worker `Galileo` implemented the module inside owned paths only: `src/lib/files/**`, `src/app/api/files/**`, and `src/app/orgs/[orgId]/files/**`. Logged ownership-boundary note that per-note attachment UI under `/notes/[id]` was out of scope for this worktree, so note attachment support was surfaced from the org files screen instead.
- `ai-summary` — worker `Leibniz` completed the module inside owned paths only after the guide refresh. It added the zod summary schema, delimiter-isolated prompt, Anthropic-primary/OpenAI-fallback provider wrapper, in-memory per-user rate limit, `POST /api/ai/notes/[noteId]/summary`, and a standalone summary page with accepted-fields persistence and audit logging. Verification remained limited by missing local `tsc`.
- `org-admin` — worker `Planck` did start after the guide refresh, but stopped on a real frozen-contract blocker: the required header org switcher lives in frozen [src/app/orgs/[orgId]/layout.tsx](/Users/yogesh/Projects/Notes%20App/src/app/orgs/[orgId]/layout.tsx) and there is no owned extension point for org-admin to implement it legally from its paths.
- `seed-10k` — worker `Ampere` implemented the large-seed workflow inside `scripts/seed/**`: deterministic org/user/note/version/share/file generation, auth-user creation via Supabase admin API, storage uploads, batched inserts, cleanup-on-failure, and summary logging. End-to-end execution was not run in-session because local tool/env setup was unavailable.
- `deploy-ops` — worker `Harvey` added `/readyz` under `src/app/readyz/**` with DB-backed readiness semantics only. This is partial relative to the later-available module guide, which also requires Supabase checks and a deploy runbook.

### 2026-04-26 — Guide refresh

- Baseline now contains module guides for `ai-summary`, `org-admin`, `seed-10k`, and `deploy-ops`.
- `Leibniz` and `Planck` were resumed with the explicit guide requirements after their first blocker-only pass.
- `Ampere` and `Harvey` need a follow-up pass against the now-present module guides to confirm alignment or patch owned surfaces.

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
## 2026-04-26 — Orchestrator takeover of Avicenna (notes-core)

**What Avicenna shipped:** schemas.ts, errors.ts, http.ts, service.ts (796 lines), diff.ts, 5 API route files, 5 app pages, server actions. Two commits were massive multi-concern bundles.

**What I intervened on:**
- Identified two bad commits (09465b5 — service + diff; a9920b0 — 5 routes in one shot)
- Surveyed via a sub-agent that returned a full bug + commit-boundary report
- Reset the branch to dc9941f and rebuilt from scratch with fixes baked in
- Split service.ts → queries.ts / crud.ts / shares.ts / history.ts
- Split 5 route files into 4 separate commits
- Split UI into 5 commits (components, actions, list page, detail page, history page)
- Baked all three fixes in-place: isRedirectError rethrow, SELECT FOR UPDATE, 23505→CONFLICT

**What was right:** Schema/type design was clean. Permission delegation to assertCanReadNote/WriteNote/ShareNote was correct. Audit calls present. diff.ts line-based approach solid.

**What was wrong:** Single-file service with all concerns mixed. Concurrent update race (no FOR UPDATE). Redirect swallowing bug. Redundant version row on soft-delete.


## 2026-04-26 — Orchestrator takeover of Planck (org-admin)

**What Planck shipped:** 3 WIP commits with docs + a Drizzle 0000 migration (frozen contract violation) + package-lock.json. Zero product code.

**What I implemented:**
- `src/lib/orgs/schemas.ts` — zod schemas for create/invite/role
- `src/lib/orgs/create.ts` — createOrg with slug uniqueness check + owner membership in one tx
- `src/lib/orgs/invite.ts` — inviteMember (token + audit_log delivery) + acceptInvite (email match guard)
- `src/lib/orgs/roles.ts` — changeRole (last-owner guard) + leaveOrg
- `src/lib/orgs/members.ts` — listMembers + listPendingInvites
- `src/app/orgs/new/page.tsx` — create-org form
- `src/app/orgs/invite/[token]/page.tsx` — invite accept page with mismatch error + sign-out
- `src/app/orgs/[orgId]/settings/page.tsx` — member list, role editor, invite form, leave button
- `src/components/org/org-switcher.tsx` — client dropdown, informational cookie, navigate

**10 commits, each one concern.** No bugs to report — implementation was clean-room from spec.

**Reasoning logged:** invite delivery via audit_log (not hidden, configurable email hook); service-role client for org creation (creator has no membership yet); email mismatch shown to user with sign-out option as spec requires.

---

## 2026-04-26 — UI loading states (orchestrator, no sub-agent)

**Trigger:** user reported blank screen during navigation — server components fetch on the server, so during transition there's nothing to render.

**Thinking:** App Router `loading.tsx` is the idiomatic fix; it wraps a segment in a Suspense boundary automatically. The wrinkle was *where* to put them. Per-module `loading.tsx` inside `notes/`, `search/`, `files/` etc. would give tailored skeletons but cross module ownership (orchestrator on `main` editing files owned by module agents — exactly what CLAUDE.md forbids). Surfaced the tradeoff to the user before acting; they confirmed the boundary-respecting option.

**What I added:**
- `src/components/ui/skeleton.tsx` — shared `Skeleton` primitive in shadcn style.
- `src/app/loading.tsx` — root fallback for `/`, `/sign-in`, `/orgs`.
- `src/app/orgs/[orgId]/loading.tsx` — segment-level fallback inherited by every module page (notes, search, files, settings) until a module agent adds a more specific override. `aria-busy` + sr-only label for accessibility.

**Why this was the right scope:** module agents can still drop their own `loading.tsx` for tailored skeletons (e.g. a notes-list-shaped fallback in `notes/loading.tsx`) without conflicting with this baseline file — Next.js resolves the closest `loading.tsx` per segment. So this fix is non-blocking for module work.

**No sub-agent used.** Three small files, well-defined contract, no parallelization benefit. Single direct write.

**Verified:** `npx tsc --noEmit` clean for new files.

---

## 2026-04-27 — Per-module loading states (parallel agent plan + orchestrator fallback)

### Parallel agent dispatch

**Plan:** dispatch 4 background sub-agents in parallel, one per module worktree, to add `loading.tsx` files and `SubmitButton` client components within each module's owned paths. This respects CLAUDE.md module ownership — each agent touches only its segment.

**Attempt 1:** dispatched all 4 simultaneously. All hit Anthropic usage limit immediately (0–1 tool calls each, no output). Reset waited.

**Attempt 2 (after reset):** same result — all 4 agents returned "hit your limit" before executing any tools.

### Orchestrator fallback

Orchestrator read every relevant page source directly (`notes/page.tsx`, `notes/[noteId]/page.tsx`, `history/page.tsx`, `settings/page.tsx`, `new/page.tsx`, `invite/[token]/page.tsx`) then executed all work inline.

### What was right

- Parallel agent architecture was correct — 4 independent modules, no shared state, natural parallelism. Would have worked if quota allowed.
- Reading source before writing was essential — the org-admin pages used raw `<button>` elements (not the `Button` component), so a generic `Button`-based `SubmitButton` would not have worked. The `SubmitButton` for org-admin was built as a plain `<button>` wrapper instead.
- ai-summary worktree created but no work added — that module has no shipped pages on `main` yet, so there was nothing to add. Documented honestly.

### What was wrong

- First dispatch was attempted without reading existing page content — only briefed agents from file-listing output. That was sufficient for `loading.tsx` (layout mirrors page structure) but would have misfired on `SubmitButton` wiring had agents run.

### Commits per module

| Module | Branch | Commits |
|---|---|---|
| notes-core | agent/notes-core-loading | 5 (SubmitButton, 3× loading.tsx, wiring) |
| search | agent/search-loading | 1 (loading.tsx) |
| org-admin | agent/org-admin-loading | 5 (SubmitButton, 3× loading.tsx, wiring) |
| ai-summary | agent/ai-summary-loading | 1 (docs only — no pages to instrument) |


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
