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
