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
