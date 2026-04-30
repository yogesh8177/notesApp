# CLAUDE.md — Notes App orchestrator brief

> Read first. This document is the contract for every agent working in this
> repo. If you're a module agent in a worktree, also read your module-specific
> guide in `docs/modules/<your-module>.md`.

## What this repo is

A multi-tenant team notes app — Auth + Orgs + Notes (CRUD, tagging, sharing,
versioning) + Search + Files + AI summaries + Audit log. Built for a 24-hour
take-home that evaluates **agent execution**: planning, parallelization,
review discipline.

## Frozen contracts — DO NOT MODIFY

The baseline `main` branch defines contracts every module depends on. Touching
these from a module worktree creates cross-module conflicts. **If you need a
change here, stop and surface it via NOTES.md before committing.**

| Path | Why frozen |
|---|---|
| `src/lib/db/schema/**` | Schema is shared by every module. Adding a column means migration coordination. |
| `drizzle/0001_*.sql`, `drizzle/0002_*.sql`, `drizzle/0003_*.sql` | Extensions, RLS, storage policies. RLS is the security boundary; do not weaken. |
| `src/lib/auth/**` | Session/org/permission helpers. Module agents CALL these; never duplicate the logic. |
| `src/lib/supabase/**` | Server/browser/service clients. Use them; do not create new ones. |
| `src/lib/log/**` | Structured logger and `audit()` writer. All audit events go through `audit()`. |
| `src/lib/validation/result.ts` | Standard error envelope. All actions/handlers return this shape. |
| `src/middleware.ts` | Auth gate. Don't add page-level auth checks — gate is here and at the org layout. |
| `src/app/orgs/[orgId]/layout.tsx` | Calls `requireOrgRole`. Module pages inherit. |
| `Dockerfile`, `railway.toml`, `.dockerignore` | Owned by `deploy-ops`. |
| `package.json` (deps) | Add deps via PR/discussion only. |

## Module ownership

Each row maps a module to its worktree, the paths it owns, and what's frozen
to it.

| Module | Worktree branch | Owns |
|---|---|---|
| `notes-core` | `agent/notes-core` | `src/lib/notes/**`, `src/app/orgs/[orgId]/notes/**`, `src/app/api/notes/**` (incl. versioning + diff under `notes/[id]/history`) |
| `search` | `agent/search` | `src/lib/search/**`, `src/app/orgs/[orgId]/search/**`, `src/app/api/search/**` |
| `files` | `agent/files` | `src/lib/files/**`, `src/app/orgs/[orgId]/files/**`, `src/app/api/files/**` |
| `ai-summary` | `agent/ai-summary` | `src/lib/ai/**`, `src/app/orgs/[orgId]/notes/[id]/summary/**`, `src/app/api/ai/**` |
| `org-admin` | `agent/org-admin` | `src/lib/orgs/**`, `src/app/orgs/[orgId]/settings/**`, `src/app/orgs/new/**`, `src/app/orgs/invite/**` |
| `seed-10k` | `agent/seed-10k` | `scripts/seed/**` |
| `deploy-ops` | `agent/deploy-ops` | `Dockerfile`, `railway.toml`, `src/app/readyz/**`, log/observability tweaks |

Two modules touching the same path = bug. If you find yourself reaching across
module boundaries, stop and surface it.

## Rules every agent follows

### 1. Commit granularity

**One logical concern per commit.** A commit message that needs the word "and"
or a multi-bullet list of unrelated changes is too big.

Good: `feat(notes): note creation server action with permission check`
Bad: `feat(notes): create + update + delete + share + versioning`

Use the conventional prefixes already used on `main`: `feat`, `fix`, `chore`,
`docs`, `test`, `refactor`, `perf`. Scope after `(...)`.

### 2. NOTES.md is append-only

After every meaningful step (plan, decision, dead-end, blocker), append to
`NOTES.md` with a date-stamped section header. Don't delete others' entries.

### 3. BUGS.md is your review trail

When you find a bug — yours, baseline's, another module's — log it in
`BUGS.md` with: what, where (file:line), why bad, fix commit SHA. Specificity
> volume.

### 4. AI_USAGE.md is honesty

Log: which sub-agent did what, what was right, what was wrong, where you
intervened. Do not gloss failures.

### 5. RLS is the security boundary

App-level checks are for UX (good error messages, early returns). RLS is what
actually keeps data safe. If you ever feel like calling the service-role
client from a request handler, **stop** — that's almost certainly wrong.

### 6. Permission checks at the action site, not the page

Layout calls `requireOrgRole`. That's enough for read-pages. **Mutations**
must individually call `assertCanWriteNote` / `assertCanShareNote` etc. before
the DB write — don't trust the layout for that.

### 7. Structured logs only

Use `log.info/warn/error/debug` — never `console.log`. Use `audit()` for any
event that should persist (auth, mutations, AI calls, denials, failures).

### 8. Server actions vs route handlers

- Server actions: note CRUD, tag/share toggles, accept-summary — small
  request bodies, no streaming.
- Route handlers: file upload (multipart), AI streaming, search (cacheable),
  webhooks.

### 9. Validate at boundaries

Every server action / route handler input goes through a zod schema. Use
`fromZod(error)` and `toResponse(result)` from `lib/validation/result.ts`.

### 10. Credit subagent work after every Agent call

After every `Agent` tool call returns, immediately run:

```bash
node .claude/hooks/log.js done "<commit subject>"
```

once per commit the subagent reports making. Do this before moving on to the
next task. Dedup is handled automatically — calling it for an item already
present is safe. This is required because concurrent hook writes race on the
session file and drop items; `log.js done` is the correctness guarantee, not
the hook.

### 11. Distrust your own output

Before committing, re-read the diff. Search for: `console.log`, `TODO`,
hardcoded UUIDs, missing `org_id` filters, unsafe `redirect_to` use, raw
SQL with template strings, prompts that interpolate user content unsafely.

## Running the app locally

```bash
cp .env.example .env
# fill in Supabase URL/keys, DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY

npm install
npm run db:generate         # regen drizzle from schema (only if you changed schema)
npm run db:migrate          # apply ALL drizzle/*.sql files in order
npm run seed                # small dev seed
npm run seed:large          # 10k notes (for search testing)
npm run dev
```

## Deliverables (graded)

- Source code with logical commit history.
- Docker + Railway deployment, demo URL.
- ~5min demo video.
- `NOTES.md` (running scratchpad) — every agent writes here.
- `AI_USAGE.md` — what each sub-agent did, parallelization map, failures.
- `BUGS.md` — bugs found in review with fix commits.
- `REVIEW.md` — what you reviewed deeply vs. sampled, distrust map, future
  review TODOs.
