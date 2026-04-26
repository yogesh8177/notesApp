# NOTES — running scratchpad

> Append-only log of plans, actions, decisions, and reasoning across the build.
> Both the orchestrator (me) and every module agent write here. Never delete
> entries; if a decision is reversed, add a new entry referencing the old one.

---

## 2026-04-26 — Baseline session (orchestrator)

### Plan

A 24h take-home: build a multi-tenant team notes app and ship it deployed to
Railway, using parallel AI agents. The way to win this is **not** to write
fast code — it's to set up rails so that 7 parallel agents can each work in
isolation without ever colliding on a shared contract.

So this baseline session does **only** three things:

1. Lock every contract two agents could disagree on (schema, RLS, auth,
   logger, route layout, error envelope).
2. Stub the app shell so each module's surface area has a place to land.
3. Document the rails: per-module CLAUDE.md telling each agent what's frozen,
   what's its job, and what's out of scope.

After this baseline merges, I spin up worktrees and run module agents
concurrently. Merge order is sequenced by dependency, not by who finishes first.

### Module split (locked)

User confirmed:

- `notes-core` — CRUD + tagging + visibility/sharing **and versioning + diff**
  (versioning merged into notes-core per user instruction; one cohesive owner
  for note mutations)
- `search` — tsvector + GIN **and** pg_trgm; org/permission scoped
- `files` — Supabase Storage; per-org bucket prefixes; signed URLs only
- `ai-summary` — Anthropic primary, OpenAI fallback; structured output;
  per-field accept
- `org-admin` — invites, role changes, member list polish
- `seed-10k` — ~10k notes, mixed visibility, overlapping tags, multi-version,
  some files
- `deploy-ops` — Dockerfile, Railway config, healthcheck, log shipping

### Stack decisions (locked, with reasoning)

- **Next.js 15 App Router + TS** — required by spec.
- **Supabase Auth + Postgres + Storage** — required.
  - Magic link **and** password (user picked both).
  - RLS enforced at the DB layer; permission helpers in app layer mirror RLS so
    we get defense in depth and good error messages on denial.
- **Drizzle** — required. Schema in `src/lib/db/schema/*`, one file per domain
  so module agents can find their tables fast. tsvector declared as a custom
  type because Drizzle has no first-class support; the column is GENERATED
  ALWAYS AS via raw SQL migration and never written from app code.
- **shadcn/ui** — components.json wired; module agents `npx shadcn add` what
  they need. Don't pre-install everything we won't use.
- **Anthropic primary, OpenAI fallback** — wrapper at `lib/ai/provider.ts`
  exposes a single `summarize(input)` and chooses provider internally. Module
  agent for ai-summary owns this.
- **Search:** tsvector + GIN for ranked relevance, pg_trgm for fuzzy/typo
  tolerance on titles. Two indexes; query joins them with `||` on rank.

### Decisions made during scaffolding

- **`auth.users` mirror via `pgSchema`** — Drizzle can reference Supabase's
  `auth.users` for FKs without owning the table. App-level profile lives in
  `public.users`, populated by trigger on signup.
- **`notes.search_vector` is GENERATED** — written exclusively by Postgres
  from `title` + `content`. Module agents must NOT write to it. This means we
  can never forget to update it; it's always coherent with the row.
- **Soft delete on `notes` and `files`** — `deleted_at` column. RLS filters
  these out of all reads; only admin/owner can see deleted via service-role
  paths.
- **`note_versions` snapshots full title+content+visibility** — not diffs.
  Storage is cheap, diff computation in the UI is fast on cached versions.
  10k notes × ~3 versions each = 30k rows of text; this is fine.
- **`audit_log` is bigserial PK** — high write volume, no need for UUID.
  Org-scoped index for fast per-org filtering.
- **`note_shares.permission` is per-user, not role** — the spec says
  "selective sharing within org boundaries" so a viewer in the org could be
  given edit on a specific note via share. Permission helpers union (org role)
  and (share permission); whichever is stronger wins.
- **`pg` connection pool with `prepare: false`** — Supabase's transaction-mode
  pooler does not support prepared statements. This is the #1 bug I'd expect
  agents to introduce; calling it out here.
- **Server actions for mutations, route handlers for AI streaming + uploads** —
  server actions don't stream and have a 1MB default body limit; they're
  fine for note CRUD but wrong for files and AI streaming.

### Risks I'm worried about (for the BUGS.md hunt later)

- **Cross-tenant leakage in search** — easiest place for an agent to forget
  the org_id WHERE clause and have the GIN index "happily" return everyone's
  notes. Search module agent gets a CLAUDE.md note pinning this as the #1
  thing to test.
- **Permission bypass in version diff** — if user A had access to a note v1
  but not v3, can they see v1 by hitting the history endpoint? Permission
  must check current note access, not v1's snapshot.
- **AI prompt injection via note content** — note content is user-controlled
  and goes into the LLM prompt. Need clear separation (user content tagged
  with delimiters), and never trust the model to refuse to leak from other
  notes — the prompt must only contain content the user already has access to.
- **File access via predictable path** — Supabase Storage RLS must be on,
  signed URLs only, no public bucket.
- **Magic link redirect open-redirect** — sign-in callback must validate
  `redirect_to` against a whitelist.

### Out of scope for this baseline (intentionally)

- Real authentication backend wiring beyond stubs — module agents fill in.
- Notes CRUD API/UI — notes-core agent.
- Search query implementation — search agent.
- File upload — files agent.
- AI integration — ai-summary agent.
- Seed content (only the framework + factories scaffolded).
- Real Railway deployment — deploy-ops agent.

### Actions taken so far this session

- `git init`, configured author.
- Wrote `package.json` with locked dep list (Next 15, React 19, Drizzle, Supabase
  SSR, Anthropic + OpenAI SDKs, shadcn deps, faker for seed, pino for logs).
- Wrote `tsconfig.json`, `next.config.ts` (standalone output for Docker),
  `tailwind.config.ts`, `postcss.config.mjs`, `components.json`,
  `drizzle.config.ts`, `.eslintrc.json`, `.env.example`.
- **Commit `28a2074`**: chore: scaffold project config.
- Drizzle schema split per domain: `enums.ts`, `users.ts`, `orgs.ts`,
  `notes.ts`, `files.ts`, `ai.ts`, `audit.ts`, plus `index.ts` re-exports.
- Wrote `src/lib/db/client.ts` — singleton pg client with `prepare: false`.

### RLS migration written — reasoning

Three SQL files, applied in order by `scripts/db/migrate.ts`:

1. `0001_extensions_and_search.sql` — `pgcrypto`, `pg_trgm`; rewrites
   `notes.search_vector` as `GENERATED ALWAYS AS STORED`; creates GIN indexes
   on the tsvector column and trigram indexes on `title`, `content`, `tags.name`.
2. `0002_rls_policies.sql` — defines two helper functions in a `private`
   schema (`is_org_member`, `has_org_role`, `can_read_note`, `can_write_note`),
   then `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every public table,
   then per-table policies. Every table uses `SECURITY DEFINER` helpers with
   `SET search_path = ''` so the helpers are not vulnerable to search_path
   hijacks. Trigger `on_auth_user_created` mirrors auth.users → public.users;
   trigger `touch_updated_at` keeps timestamps fresh.
3. `0003_storage_policies.sql` — creates the private `notes-files` bucket and
   storage RLS policies keyed on the first path segment of object name (the
   org ID). App layer is responsible for enforcing per-note write checks
   before the upload — storage policy enforces only org membership.

**Important guarantee:** `notes.search_vector` is a generated column. Module
agents physically cannot write to it. Search will always be coherent with the
row.

**Important guarantee:** the `auth.uid()` function returns NULL for the
service-role connection — that's why service-role bypasses RLS, and that's
why we ONLY use service role in trusted server code (migrations, seed, audit
log writes).

### Up next this session

- Auth helpers — Supabase server/client/middleware, `getSession`,
  `getActiveOrg`, `requireOrgRole`.
- Permission helpers — `canReadNote`, `canWriteNote`, `canShareNote`.
  Rule: app-level helpers must mirror the SQL helpers above. They exist for
  good error messages + early returns; RLS is the actual security boundary.
- Structured logger + audit log writer.
- App shell — sign-in page, orgs list, org layout with switcher, route stubs.
- shadcn primitives.
- Seed framework scaffold.
- Dockerfile + railway.toml + healthcheck.
- All .md docs.

---

## 2026-04-26 — Worktree orchestration (orchestrator)

### Decision

CLAUDE's ownership model is now enforced with isolated git worktrees off the
frozen `main` baseline. I did not let module work land on `main`; every active
worker is confined to its own branch/worktree pair.

### Worktree map

- `agent/notes-core` → `/private/tmp/notes-app-notes-core`
- `agent/search` → `/private/tmp/notes-app-search`
- `agent/files` → `/private/tmp/notes-app-files`
- `agent/ai-summary` → `/private/tmp/notes-app-ai-summary`
- `agent/org-admin` → `/private/tmp/notes-app-org-admin`
- `agent/seed-10k` → `/private/tmp/notes-app-seed-10k`
- `agent/deploy-ops` → `/private/tmp/notes-app-deploy-ops`

### Active dispatch

- `notes-core`, `search`, `files` received implementation prompts tied to
  their module guides and owned paths only.
- `ai-summary`, `org-admin`, `seed-10k` received scoped discovery-or-implement
  prompts because their module guides are not present locally.
- `deploy-ops` is queued until the runtime frees one more agent slot; the
  worktree/branch already exists.

### Constraint enforced

The sandbox blocks writes under `.git`, so worktree creation required
escalation. That escalation was used only to materialize the git worktrees; no
baseline source files were edited on `main`.

---

## 2026-04-26 — ai-summary implementation resumed

### Step 1: contract reload

- Read root `CLAUDE.md` and `docs/modules/ai-summary.md`.
- Confirmed the local guide now freezes the implementation surface sufficiently:
  - Anthropic primary, OpenAI fallback
  - zod structured summary schema
  - delimiter-isolated prompt
  - `POST /api/ai/notes/[noteId]/summary`
  - per-user in-memory rate limit
  - acceptance flow writing `accepted_fields` and `status='accepted'`

### Step 2: schema decision

- Implemented `src/lib/ai/schema.ts` as the app-side structured contract referenced by the frozen DB schema comments.
- Chose top-level accepted fields (`tldr`, `keyPoints`, `actionItems`, `entities`) for the acceptance UI. This satisfies the guide's "per-field accept" requirement without inventing nested acceptance semantics that are not frozen anywhere else in baseline.

### Step 3: prompt isolation

- Added `src/lib/ai/prompt.ts`.
- The prompt keeps user note content inside explicit `<note>` delimiters and instructs the model to treat that content as data rather than instructions.
- The prompt only interpolates `title` and `content`; it does not include org names, user identifiers, or any other cross-tenant context.

### Step 4: provider wrapper

- Added `src/lib/ai/provider.ts` with a single `summarize({ title, content })` entrypoint.
- Anthropic is primary; OpenAI is fallback on any Anthropic upstream error or timeout over 30 seconds.
- Provider outputs are parsed against the zod summary schema. Parse/validation failures retry once on the same provider before that provider is considered failed.
- If both providers fail, the wrapper throws a typed `SummarizeProvidersError` that carries per-provider failure details for the route handler to persist and return as an `UPSTREAM` failure.
