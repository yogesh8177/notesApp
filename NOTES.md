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

## 2026-04-26 — Baseline vs worktree clarification (orchestrator)

### Answer

Module implementation work from the dispatched agents is landing in the
non-baseline worktrees and branches, not in the frozen baseline worktree on
`main`.

### Important exception

`main` still carries orchestration-doc edits made by the orchestrator:

- `NOTES.md`
- `AI_USAGE.md`

Those are coordination artifacts, not module product code.

### Current baseline-side drift to inspect, not overwrite

- `docs/modules/seed-10k.md` is currently modified in the baseline worktree.
  I did not revert it. It now contains explicit data-semantics guidance that
  was not available to the first `seed-10k` dispatch and needs to be treated
  as the current contract.

## 2026-04-26 — Guide refresh and re-dispatch (orchestrator)

### New information

The baseline now contains module guides for:

- `docs/modules/ai-summary.md`
- `docs/modules/org-admin.md`
- `docs/modules/deploy-ops.md`
- `docs/modules/seed-10k.md`

These guides were not available to the first pass of some module workers, so
their original blocker conclusions are stale.

### Actions

- Resumed `Leibniz` on `agent/ai-summary` with the explicit `ai-summary` guide.
- Resumed `Planck` on `agent/org-admin` with the explicit `org-admin` guide.
- Marked `Ampere` and `Harvey` for follow-up alignment against the now-present
  `seed-10k` and `deploy-ops` guides.
- `Avicenna` (`notes-core`) is still the long-running active implementation
  worker and remains isolated in `/private/tmp/notes-app-notes-core`.
## 2026-04-26 — seed-10k module outcome (`Ampere`, `agent/seed-10k`)

### Reasoning summary

- Stayed inside `scripts/seed/**`.
- Implemented deterministic large-scale seed generation with batched writes,
  auth-user creation, storage uploads, and cleanup-on-failure.
- Did not run the full seed in-session because the worktree lacked validated
  env/tooling for a safe end-to-end run.

### Follow-up

## 2026-04-26 — seed-10k follow-up audit (`Codex`, `agent/seed-10k`)

### Step 1 — contract read

- Re-read root `CLAUDE.md` and `docs/modules/seed-10k.md` before touching code.
- Confirmed path ownership remains restricted to `scripts/seed/**` plus append-only
  notes files in this worktree.

### Step 2 — guide mismatch noted

- The local `docs/modules/seed-10k.md` is 83 lines and does **not** contain the
  referenced `Data Semantics (CRITICAL for AI Summary & Search)` section.
- Because that section is absent locally, this pass audits against the explicit
  requirements that are present in the module guide, with extra attention to the
  data-shape points that directly affect search isolation and AI-summary realism.

### Step 3 — current implementation audit against explicit guide

- `scripts/seed/run.ts` defaults to `2 orgs / 5 users / 100 notes`, while
  `package.json` sets `seed:large` to only override `SEED_NOTE_COUNT=10000`.
  Result: `pnpm seed:large` currently produces 2 orgs and 5 users instead of the
  required 5 orgs and 20 users.
- `scripts/seed/factories.ts` builds org memberships independently per org, so it
  does not guarantee at least 3 users belong to all 5 orgs, and it does not
  reliably keep most users in only 1–2 orgs.
- Notes are distributed evenly by org, not roughly proportional to org size.
- Tag generation yields about 13 tags/org in the current shape, below the required
  15–30 tag values per org.
- Version distribution is skewed toward single-version notes (50% version 1),
  which conflicts with the guide's requirement that most notes have 2–3 versions.
- File generation currently creates note attachments opportunistically from note
  count (~5% of notes, often 1–3 each), which would overshoot the required
  ~100 total files for a 10k run and never creates the required ~20% org-level files.
- File MIME types are currently `md/txt/csv/json`, which misses the explicitly
  required `pdf/png/txt/md` mix.
- `run.ts` logs generated counts but does not print actual table row counts or
  2–3 sample login emails at the end as required.

### Decision

- Patch `scripts/seed/**` only.
- Preserve deterministic behavior and existing transactional cleanup flow.

### Step 4 — patches applied

- Updated `scripts/seed/run.ts` defaults to `5 orgs / 20 users` so
  `pnpm seed:large` now aligns with the explicit module-guide defaults when only
  `SEED_NOTE_COUNT=10000` is provided.
- Updated `scripts/seed/factories.ts` membership generation to guarantee:
  at least 3 users belong to all orgs, most remaining users land in 1–2 orgs,
  and each org gets one owner plus 1–2 admins with viewer coverage.
- Changed note allocation from even distribution to weighted distribution based
  on org membership counts.
- Expanded per-org tags into the required 15–30 range while preserving explicit
  overlap tags such as `roadmap`, `todo`, and `meeting`.
- Changed title generation so repeated titles now occur across orgs, which is
  important for search-isolation checks.
- Rebalanced version counts so most notes now land in versions 2–3 instead of
  version 1.
- Reworked file generation to target roughly 1% of note count, yielding
  ~100 files on a 10k run with an 80/20 note-level vs org-level split.
- Switched file MIME coverage to the required `pdf/png/txt/md` set and changed
  placeholder file bodies to binary-safe buffers.
- Added end-of-run summary output for actual table counts plus 2–3 sample login
  emails.

### Step 5 — verification

- `git diff --check -- scripts/seed/factories.ts scripts/seed/run.ts NOTES.md`
  passed with no whitespace or patch-format issues.
- `npm run typecheck` could not complete in this worktree because `tsc` is not
  installed locally (`sh: tsc: command not found`). No full TypeScript compile
  verification was possible inside the current environment.

- Baseline `docs/modules/seed-10k.md` now includes explicit data-semantics
  requirements for realistic AI/search-friendly content. This implementation
  needs a guide-alignment pass rather than assumptions.
Dispatch four parallel module agents — one per worktree — each working only within their owned paths. Orchestrator read the existing page source first to brief them precisely. Two sub-agent dispatch attempts failed immediately (Anthropic usage limit). Orchestrator executed all work directly.

### Work done per module

**notes-core** (`agent/notes-core-loading`):
- `notes/_components/submit-button.tsx` — `SubmitButton` client component (`useFormStatus`)
- `notes/loading.tsx` — skeleton for notes list (filter card + note cards)
- `notes/[noteId]/loading.tsx` — skeleton for note detail (edit card + sharing card + recent versions)
- `notes/[noteId]/history/loading.tsx` — skeleton for history (diff card + version list)
- Wired `SubmitButton` into: create note, save/delete note, add/remove share forms

**search** (`agent/search-loading`):
- `search/loading.tsx` — skeleton for search page (search bar + result cards)

**org-admin** (`agent/org-admin-loading`):
- `_components/submit-button.tsx` — `SubmitButton` for raw `<button>` elements in org pages
- `settings/loading.tsx` — skeleton (member list + invite form + danger zone)
- `new/loading.tsx` — skeleton for create-org form
- `invite/[token]/loading.tsx` — skeleton for invite accept page
- Wired `SubmitButton` into: role save, send invite, leave org, create org

**ai-summary** (`agent/ai-summary-loading`):
- No owned pages exist yet on `main` — module agent has not shipped yet. Nothing to add; worktree branch preserved for when ai-summary ships its pages.

### Commit shape

Each concern is a separate commit per CLAUDE.md rules. SubmitButton → loading.tsx files → wiring → docs.


---

## 2026-04-27 — Production build fixes (orchestrator)

### Problem
`npm run build` failed with ESLint errors and TypeScript type errors across multiple files. None had been caught earlier because `tsc --noEmit` was used for type checks but the Next.js build runs ESLint + full type checking with stricter constraints.

### Fixes applied

- **`src/lib/log/index.ts`** — removed `eslint-disable` comment referencing `@typescript-eslint/no-require-imports` rule which is not in the ESLint config (`next/core-web-vitals`). Without the comment the `require()` passes cleanly.
- **`src/app/orgs/invite/[token]/page.tsx`** — replaced bare `<a href="/orgs">` with `<Link>` (Next.js lint rule); fixed `result.error?.code` → `result.code` and `result.error?.message` → `result.message` (Err type has flat shape, not nested under `.error`).
- **`src/app/orgs/[orgId]/files/files-client.tsx`** — wrapped `refreshFiles` in `useCallback([orgId])` and added it to `useEffect` deps to satisfy `react-hooks/exhaustive-deps`.
- **`src/lib/ai/schema.ts`** — replaced loop-with-indexed-assignment with `Object.fromEntries` to avoid TypeScript union intersection error on discriminated field type.
- **`src/lib/auth/permissions.ts`** — Drizzle infers `noteShares.permission` as the literal default `"view" | null` on left-join columns rather than the full `SharePermission` enum. Extracted `hasEditShare = (shareRaw as string | null) === "edit"` to bypass the TS2367 comparison error.
- **`src/lib/files/index.ts`** — `row.uploader` is from a left join and can be null; added optional chaining.
- **`src/lib/validation/result.ts`** — added `"UNPROCESSABLE"` to `ErrorCode` union (used in `orgs/roles.ts` and `orgs/invite.ts` but missing from the baseline enum).
- **`src/lib/supabase/middleware.ts` + `server.ts`** — added explicit `{ name: string; value: string; options?: object }[]` type to `setAll` callback parameter.
- **`src/lib/env.ts`** — removed `.min(1)` from `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (both `.optional()`). An empty string in `.env` caused `min(1)` to fail at build time during static route generation even though the vars are optional at runtime.

## 2026-04-27 — Performance: eliminated double auth round-trip + dev pool fix (orchestrator)

### Problem
API calls taking 2–3 seconds on localhost. User reported consistent slowness across all pages.

### Root causes identified

1. **Double `getUser()` network call per request**
   - `src/lib/supabase/middleware.ts` calls `supabase.auth.getUser()` to refresh the JWT (~150–300ms, network call to Supabase auth server)
   - `src/lib/auth/session.ts` `getCurrentUser()` also called `supabase.auth.getUser()` — another ~150–300ms network call, every page, every request
   - These are sequential from the user's perspective: middleware fires first, then layout + page render calls `getCurrentUser()`

2. **Dev connection pool size = 1**
   - `src/lib/db/client.ts` used `max: 1` in dev
   - Notes list and note detail pages use `Promise.all([loadTagsForNotes, loadShareCounts, ...])` to batch queries
   - With pool `max: 1`, those parallel promises serialized through one connection — no actual parallelism in dev

### Fixes

- **`src/lib/auth/session.ts`** — switched `getCurrentUser()` from `getUser()` to `getSession()`. The middleware already ran `getUser()` and refreshed the cookie. `getSession()` reads the JWT claims from the cookie locally — no network call. Security is unchanged: RLS enforces data isolation; middleware handles JWT refresh.
- **`src/lib/db/client.ts`** — raised dev pool `max: 1 → 5` so concurrent queries in `Promise.all` actually run in parallel.

### What's still there
- The middleware `getUser()` call (~150ms) is unavoidable — it's what keeps the session cookie fresh.
- Geographic latency if Railway region ≠ Supabase region — fix by aligning regions in Railway/Supabase dashboards.

## 2026-04-27 — Features: files-in-notes + summary visibility + search (orchestrator)

### Summary

Two features dispatched to module agents; all three sub-agent attempts failed (environment denied Bash/tool access). Orchestrator implemented directly in both worktrees.

### Files module (`agent/files`) — commit `1cd2d67`
- `src/lib/files/index.ts`: added `countFilesForNote`, `getFilesForNote`, `MAX_FILES_PER_NOTE=5`. Cap enforced in `createUpload` before signed URL issuance.
- `src/app/api/files/route.ts`: GET now handles `?noteId=` (note-scoped list) alongside `?orgId=` (org-scoped list).
- `src/app/orgs/[orgId]/files/_components/note-file-uploader.tsx`: client component — X/5 counter, multi-file picker, upload progress, download/remove. Disabled at cap.
- **Pending**: notes-core must import `<NoteFileUploader noteId={noteId} orgId={orgId} canWrite={...} />` into note create/edit forms.

### AI Summary module (`agent/ai-summary`) — commit `a6fc868`
- `src/app/orgs/[orgId]/notes/[noteId]/layout.tsx`: adds "Note" + "AI Summary" tab navigation. Wraps child routes; no notes-core files touched.
- `src/lib/ai/summary-search.ts`: `getSummaryMatchingNoteIds(orgId, term)` — queries `ai_summaries.structured` JSONB for `tldr` + `keyPoints` matches via `ilike`.
- **Pending**: notes-core must call `getSummaryMatchingNoteIds` in `listNotesForUser` to extend search to summary text. Integration snippet in that module's NOTES.md.

## 2026-04-27 — Multi-tenancy audit + admin/private visibility decision

### Audit result
Full read of all query/mutation paths. App is multi-tenant safe:
- Every note read goes through `assertCanReadNote` → joins `memberships ON notes.orgId` — user from org A gets `role: null` on org B's note, access denied
- Every write calls `assertCanWriteNote` / `assertCanShareNote` / `requireOrgRole`
- Search enforces `eq(notes.orgId, input.orgId)` + `getMembership` check + `buildReadablePredicate` SQL
- Only active bug was `getSummaryMatchingNoteIds` missing org filter (fixed, BUGS.md)

## 2026-04-27 — seed-10k: worktree rebased + implementation reviewed (orchestrator)

### Context

The `agent/seed-10k` worktree at `/private/tmp/notes-app-seed-10k` had a single WIP commit (`42cafc2`) from the previous session's `Ampere` agent. It was 6 commits behind `main` (doc and production fixes had landed on main after the seed branch diverged). The seed files themselves were complete — the WIP commit contained full implementations of both `factories.ts` and `run.ts`.

### What was done

1. **Rebase** — `agent/seed-10k` rebased onto `main`. Only conflict was `NOTES.md` (doc-only). Resolved by taking main's version (`git checkout --theirs`), preserving the seed implementation cleanly.
2. **WIP commit split** — reset the single WIP commit and re-committed as 3 atomic commits per the module guide's conventions:
   - `e91b1c3` `feat(seed): factories`
   - `c47a0dd` `feat(seed): run`
   - `9ce82df` `docs(seed): NOTES and AI_USAGE`
3. **Type-check** — `tsc --noEmit` clean on the worktree.
4. **Force-push** — `--force-with-lease` to `origin/agent/seed-10k` after rebase rewrote history.

### Key design decisions in the seed

**Why no faker.lorem for content:**
The spec explicitly bans it. Graders use AI summary and search against this data. If content is gibberish, the AI summarizer produces garbage summaries and reviewers can't tell whether search is actually working. Corporate-style titles and structured bodies are necessary for meaningful end-to-end testing.

**Title generation strategy:**
`NOTE_SUBJECTS` × `TITLE_QUALIFIERS` combinatorics guarantee predictable, searchable titles ("Weekly Sync Q3", "Launch Checklist Sprint"). The same subject repeats across orgs intentionally — this is the primary test for search tenant isolation: searching "launch checklist" should scope to the user's org only.

**Structured body format (`makeStructuredBody`):**
Three sections: `## Context` (2–4 sentences of realistic prose), `## Decisions` (3 bullet points from a fixed pool), `## Next` (2 action items as `[ ]` markdown checkboxes). Version updates change `[ ]` to `[x]` and append a Resolution line. This makes the diff viewer show meaningful changes per version, which is required for the version history feature review.

**Tag strategy:**
5 required overlap tags (`roadmap`, `todo`, `meeting`, `retro`, `customer`) are guaranteed in every org. These overlap deliberately — graders can test that `#roadmap` tag search scopes to the current org only. Each org also gets org-specific specialist tags (infra/api/observability for Engineering orgs, ux/research/prototype for Design orgs, etc.) so tag facets look realistic.

**Idempotency (cleanup-first pattern):**
Seed is not fully idempotent (it can't reuse existing user IDs), so it's cleanup-then-reseed. Cleanup order matters: storage objects first (requires orgId FK for the query), then DB rows (org cascade handles notes/memberships/etc.), then auth users. The email prefix + org slug prefix pattern makes prior seed rows identifiable without needing a seed run ID.

**Batching and transactions:**
500-row batches keep Postgres statement memory manageable for 10k notes. All DB inserts run inside a single transaction — a failure rolls back everything. Storage uploads are outside the transaction (can't roll back object storage) but the catch block removes them. Upload batches are 100 concurrent requests (smaller than row batches) because each is a network call to Supabase Storage.

**`waitForProfiles` pattern:**
The `on_auth_user_created` trigger is synchronous in most Supabase configurations but the SDK's `admin.createUser` returns before the trigger runs in some edge cases. The polling loop (250ms interval, 10s timeout) avoids FK violations when inserting membership rows before the `public.users` mirror row exists.

**File body content:**
Real minimal valid file bodies: a 1×1 PNG (base64 constant), a minimal valid PDF with a title in the content stream, and markdown/txt as UTF-8 text. These are small enough for fast upload but valid enough that a MIME sniff won't reject them.

---

## 2026-04-27 — Search filter-only bug fix + observability gaps (orchestrator)

### Search: filter-only searches were broken

`shouldSearch = Boolean(filters.q)` in `search/page.tsx` meant tag filter, author filter, and date-range filters produced no results without a text query. `searchRequestSchema` also made `q` required, so the API route returned 400 for filter-only requests.

**Fixes:**
- `shouldSearch` → `hasActiveSearchFilters(filters)`
- `searchRequestSchema` — `q` made optional
- New `browseFiltered()` in `service.ts` — handles filter-only queries with `updatedAt DESC` sort, same base conditions (org isolation, visibility predicate, tag EXISTS, author, date range)
- Guard added to audit log call: `(input.q ?? "").slice(0, 256)`

**Multi-tenancy verified clean** — all search paths enforce `eq(notes.orgId, input.orgId)`, tag EXISTS pins to `t.org_id = input.orgId`, `searchByTag` looks up tag by `eq(tags.orgId, input.orgId)`.

### Observability: permission denials and action failures not logged

Audited all note permission helpers and server actions. Found two gaps:
1. `assertCanReadNote/WriteNote/ShareNote` threw `PermissionError` silently — no log, no audit event
2. All five note server actions swallowed errors into flash redirects with no server-side trace

**Fixes:**
- `permissions.ts`: `log.warn` before each `PermissionError` throw
- `actions.ts`: `log.error` for `INTERNAL`-coded errors, `log.warn` for `FORBIDDEN`-coded errors, nothing for normal user errors

**Rule going forward:** Any security-relevant denial must emit at least `log.warn`. Any unexpected failure must emit `log.error`. Expected user-facing errors (not found, conflict) go to flash only.

---

## 2026-04-27 — Auth security revert + file upload error visibility (orchestrator)

### Auth: reverted getSession() → getUser()

During the file upload debugging session, the Supabase SDK emitted a runtime warning:
> "Using the user object as returned from `getSession()` or from some `onAuthStateChange()` events could be insecure. This value comes directly from the storage medium (usually cookies) and may not be authentic. Use `supabase.auth.getUser()` instead."

The previous performance optimisation in `src/lib/auth/session.ts` switched `getCurrentUser()` to `getSession()` to eliminate a Supabase Auth network round-trip. The reasoning was that middleware's `getUser()` already validated the JWT on the same request. Supabase SDK's explicit warning indicates this is not a safe assumption — `getSession()` reads cookie claims without Auth-server verification, which is insufficient for a security boundary.

**Decision:** Reverted to `getUser()`. The `cache()` wrapper still deduplicates to one network call per render tree. The DB pool fix (`max: 5`) is what actually resolved the bulk of the latency regression, not the `getSession()` switch.

**Rule going forward:** Never use `getSession()` in server components, server actions, or route handlers for the authenticated user identity. Use `getUser()` always. `getSession()` is appropriate only for reading non-security-sensitive JWT claims (e.g., display hints) where stale data is acceptable.

### Files: log real Supabase error before throwing UPSTREAM

`createUpload()` in `src/lib/files/index.ts` was discarding the underlying `StorageError` entirely. Added `log.error({ err: error, bucket: FILES_BUCKET, storagePath }, "files.signed_url_failed")` before the throw. Now the real error (wrong bucket, missing key, RLS denial, etc.) appears in server logs.

**Diagnosis of the user's upload error:** Most likely cause is `drizzle/0003_storage_policies.sql` not having been run — the `notes-files` storage bucket is created there. Run that migration in Supabase Dashboard → SQL Editor, or create the bucket manually as private. Alternatively, verify `SUPABASE_SERVICE_ROLE_KEY` is set correctly in `.env`.

**Commit:** `8b14459` on `main`

---

### Conscious decision: admin visibility inconsistency

**Behaviour:** Org admins can access any note (including private notes by other members) via direct URL/ID. However, private notes authored by others do NOT appear in search results for admins.

**Why this is intentional:**
- `computeCanRead` in `permissions.ts` grants admins full read access for support/moderation use cases — accessing a specific note when reported or when debugging
- `buildReadablePredicate` in `search/service.ts` intentionally omits the admin bypass — search is a discovery tool and private notes should not be discoverable even by admins
- This is the safer direction: admins can read if they have the ID, but cannot enumerate or discover private content through search

**Decision: do not fix.** This asymmetry is acceptable and arguably correct UX for a multi-tenant notes product. If full admin enumeration is ever needed, add an explicit "admin mode" search flag rather than silently leaking private notes into search results.

---

## 2026-04-27 — Files pagination (orchestrator)

### Problem found: unbounded listFilesForOrg

`listFilesForOrg` had no `.limit()`. At 10k notes × 5 files = 50k possible rows — single DB query, materialised into Node.js memory, serialised as one JSON response. Immediate performance cliff at seed scale.

### Fix: cursor keyset pagination

- **Cursor:** base64url-encoded `{t: createdAt ISO, id: uuid}`. Composite sort `(createdAt DESC, id ASC)` — `id` is a stable tiebreaker when multiple files share the same timestamp (batch uploads).
- **Page size:** 50 items (constant in `validation.ts` so API and service agree).
- **Sentinel technique:** fetch `PAGE_SIZE + 1`; if filtered results exceed `PAGE_SIZE`, truncate and emit cursor pointing to the 50th item. No cursor = end of list.
- **JS visibility filter interaction:** post-filter runs on the DB batch. If many files are hidden (private notes), visible items per page may be fewer than 50 even if more DB rows exist — next page may return 0 visible items. Acceptable tradeoff vs. complexity of looping until full page. For this workload (most files visible to org members) the practical impact is negligible.
- **Client:** `fetchPage(cursor, append)` accumulates state; `loadMore` callback passes current `nextCursor`; "Load more" button only renders when `nextCursor` is present.
- **Commit:** `481d8e9` on `main`

### REVIEW note: distrust agent-generated pagination at scale

Cursor logic is a class of code where agents produce plausible-looking but subtly wrong implementations — particularly around:
1. Off-by-one in `PAGE_SIZE + 1` detection when the visibility filter removes rows from the sentinel row
2. Cursor encoding that loses precision (e.g., millisecond timestamps rounded to seconds)
3. Missing secondary sort key causing non-deterministic ordering and infinite cursors

All three were checked manually before commit. The `(createdAt DESC, id ASC)` sort is deterministic because `id` is a UUID primary key unique per row. The cursor encodes the full ISO 8601 timestamp with ms precision. The `> PAGE_SIZE` check (not `>= PAGE_SIZE`) correctly identifies when the sentinel row is present.

---

## 2026-04-27 — Railway reverse-proxy redirect bug (orchestrator)

### Problem
Magic link login and sign-out redirected to `https://0.0.0.0:8080/...` in production. Railway binds Next.js internally on `0.0.0.0:8080`; `request.nextUrl.origin` reflects that internal address, not the public Railway domain. Both `auth/callback/route.ts` and `auth/sign-out/route.ts` cloned `request.nextUrl` for redirects, leaking the internal host to the browser.

The OTP expired error was a secondary symptom — the magic link in the email pointed to the correct Railway URL (constructed from `window.location.origin` in the browser), but after Supabase processed the code it redirected using the server-side internal URL, making the link appear broken.

### Fix
`publicUrl(path, request)` in `src/lib/auth/public-url.ts`:
- Reads `x-forwarded-host` (Railway proxy sets this to the public domain)
- Reads `x-forwarded-proto` (Railway proxy sets this to `https`)
- Falls back to `request.nextUrl.origin` locally where no proxy is present

All `NextResponse.redirect` calls in both auth routes now use `publicUrl()`.

**Commit:** `99fcba4` on `main`

---

## 2026-04-27 — What we'd do with more time (orchestrator)

### Multi-tenancy hardening

**RLS as the primary DB-layer isolation guarantee**
Currently RLS policies enforce tenant isolation at the Postgres level, but the app also opens a direct superuser connection for the seed and for service-role operations (storage, admin auth). With more time:
- Tighten the service-role surface — create a dedicated limited-privilege DB role for the app runtime that can only SELECT/INSERT/UPDATE/DELETE on app tables, and reserve the superuser connection strictly for migrations and seed scripts.
- Add a nightly diff job that compares `getNotePermission()` output against what the RLS policies would allow for a sample of (user, note) pairs — catches app-vs-RLS drift before it becomes a production incident.
- Property-based tests covering the full permission matrix: `visibility × role × is-author × share-edit/view × deleted`. Current test coverage is zero; any refactor of the permission helpers is unverified.

**Per-org database isolation (beyond RLS)**
For a genuinely multi-tenant SaaS at scale, RLS on a shared schema is a good start but has blast-radius risk if a policy is misconfigured. The next tier is schema-per-tenant or database-per-tenant, with a connection router that maps `orgId → connection string`. Supabase doesn't support this natively but a proxy layer (PgBouncer + custom routing) could achieve it. Overkill for this build; correct direction for a production product.

---

### Semantic search and file embedding

**Embed files — PDFs, images, video transcripts**
Current search indexes note title and content only. With more time:
- **PDFs:** extract text at upload time (pdf-parse or Supabase Edge Function), chunk into ~500-token segments, embed with `text-embedding-3-small`, store vectors in `pgvector`. Search becomes a combined BM25 (tsvector) + cosine similarity (`<=>`) query ranked by RRF.
- **Images:** run OCR (Tesseract or Google Vision API) at upload; embed the extracted text alongside the note content. For non-text images, generate an alt-text caption via a vision model and embed that.
- **Video/audio:** transcribe with Whisper at upload, chunk transcript, embed segments. Attach timestamps so search results can deep-link to the relevant moment.
- **Unified vector table:** `embeddings(id, org_id, source_type, source_id, chunk_index, content_chunk, embedding vector(1536))`. HNSW index on `embedding`. Query: cosine similarity filtered by `org_id` (tenant isolation must be enforced at the embedding query layer, not just the surface).

---

### Scale improvements

**Search**
- Move tsvector maintenance from runtime (`to_tsvector` on every query) to a stored generated column updated by trigger — eliminates per-query vectorisation at the cost of write amplification, which is the correct tradeoff for a read-heavy search workload.
- Add a search result cache (Redis or Supabase Edge Cache) keyed on `(orgId, queryHash)` with a short TTL (30s). Most search queries in a given org repeat within a session.
- For very large orgs (>100k notes), partition the `notes` table by `org_id` hash. Queries filtered by `org_id` scan only one partition; RLS policies and indexes follow the partition boundary.

**File storage**
- The current visibility filter on `listFilesForOrg` is post-query JS — fetch 51 rows, filter, may return fewer than 50 if many are on private notes. At scale, push visibility into the SQL WHERE clause using the same predicate as notes so the DB does the filtering and the page is always full.
- Add virus/malware scanning on upload via a Supabase Storage webhook (ClamAV or a third-party scanner). Current implementation trusts all uploaded bytes.
- MIME type validation server-side: currently trusts the client-supplied `mimeType`. Should sniff the actual magic bytes of the stored object after upload and reject mismatches.

**AI summaries**
- The in-memory rate limiter resets on process restart and doesn't work across multiple Railway replicas. Replace with a Redis counter keyed on `(userId, window)`.
- Stream AI output through a Supabase Realtime channel instead of a route handler — decouples the generation lifecycle from the HTTP connection, survives client reconnects, and allows resuming a partially streamed summary.
- Store embeddings of accepted summaries in the vector table above — summaries are high-signal compact representations of note content and produce better semantic search results than raw note text.

**Observability**
- Replace stdout-only pino logs with a real log sink (Logtail, Better Stack, or Datadog). Current Railway deployment has no log retention or alerting.
- Add structured trace IDs propagated through server actions and route handlers so a single user action can be correlated across the audit log, application logs, and DB query logs.
- Instrument `listNotesForUser`, `searchNotes`, and `listFilesForOrg` with p50/p95/p99 latency metrics. The 10k seed is the baseline; alert if p95 exceeds 500ms.

**Auth**
- Magic link OTP expiry is currently 1 hour (Supabase default). For a team notes app, shorten to 15 minutes and add a "resend" flow.
- Add PKCE to the magic link flow (Supabase supports it) — prevents code interception in shared environments.
- Session rotation on privilege escalation (role change within an org) — current sessions survive role downgrades until natural expiry.

---

## 2026-04-27 — Noisy neighbour problem (orchestrator)

### The problem
Every tenant shares the same Postgres instance, the same Next.js process, and the same Railway container. A single org running `seed:large` (10k notes, 25k versions, 100k search queries) will saturate connection pool slots, spike CPU on tsvector ranking, and slow down every other tenant's reads — with zero isolation between them.

### DB layer

**Connection pool fairness**
Current setup: one PgBouncer pool shared across all tenants. A burst from org A exhausts the pool; org B gets connection timeouts. Fix: per-tenant connection limits in PgBouncer, or move to Supabase's built-in pooler with `pool_mode=transaction` and a max-connections-per-user cap. At minimum, set `statement_timeout` and `lock_timeout` at the session level so a runaway query from one tenant can't hold locks indefinitely.

**Query cost isolation**
A 10k-note org running a broad FTS query (`plainto_tsquery('the')`) will do a full index scan and monopolise shared I/O. Fix:
- `pg_stat_statements` + per-org query budgets enforced via a query cancellation job
- Rate-limit the `/api/search` route handler per `orgId` (not just per user) — a single org can't hammer search at the expense of others
- Add `LIMIT` guards deep in the service layer so no single query can return unbounded rows regardless of what the caller requests

**Resource quotas per org**
No enforcement today on notes count, file storage bytes, or version history depth per org. At scale these become attack surfaces — one org fills the disk, another creates 1M versions of a single note. Add `org_quotas` table and enforce limits at the mutation site before insert.

### Application layer

**Next.js process**
All tenants share the same Node.js event loop. A CPU-heavy operation (large diff computation, streaming AI response, parsing a 10MB PDF) blocks the loop for everyone. Fix:
- Move heavy work to background jobs (Railway worker service or Supabase Edge Functions) so the web process stays responsive
- Stream AI responses through a job queue rather than holding an HTTP connection open — a slow Anthropic response today ties up a Node.js connection slot for every concurrent user

**In-memory rate limiter**
The AI summary rate limiter is per-process in-memory. Across multiple Railway replicas each process has its own counter — a user can multiply their allowed rate by the replica count. Replace with a Redis atomic counter (`INCR` + `EXPIRE`) shared across all replicas.

**Per-org request rate limiting**
No org-level rate limiting at the API layer today. One org scripting the notes API can generate thousands of requests per second, starving other tenants at the load balancer level. Add a Redis sliding-window rate limit keyed on `orgId` in middleware, separate from per-user limits.

**Single tags search***
No multi tag search at the moment, one tag at a time can be searched via dropdown flow.

### Infrastructure layer

**Shared Railway container**
Currently one Railway service = one container = all tenants. True isolation requires either:
- **Vertical partitioning by tier:** free orgs share a container, paid orgs get dedicated containers — standard SaaS model
- **Horizontal sharding:** route requests for large orgs to dedicated Next.js + Postgres instances based on a tenant registry
- **Minimum viable isolation now:** set Railway memory/CPU limits on the container so one runaway tenant can't OOM the whole process; add a `/healthz` latency check that alerts before degradation is user-visible

### Minimum viable mitigation for this build
In priority order:
1. `statement_timeout = 5s` on all DB sessions — prevents one slow query from holding connections
2. Per-`orgId` rate limit on `/api/search` and `/api/ai` (the two most expensive endpoints)
3. `org_quotas` table with notes/files/storage caps enforced at insert
4. Redis rate limiter replacing the in-memory AI limiter before adding replicas

---

## 2026-04-26/27 — Cross-cut ops notes moved out of BUGS.md (orchestrator)

These are not bug findings; they were misfiled under the search bug entries:

- **seed-10k guide rebase**: `docs/modules/seed-10k.md` was updated on `main` after the agent's worktree was created, so the worktree implemented an older plan. Resolved by rebasing the worktree onto `main` and re-running the implementation against the updated guide.
- **org-admin org-switcher permission grant**: org-admin agent stopped on encountering the org switcher in `orgs/[orgId]/layout.tsx` because the file was outside its declared module ownership. Orchestrator granted the cross-cut permission after confirming org-admin is the right owner of the switcher surface; documented in CLAUDE.md ownership matrix.

---

## 2026-04-28 — Documentation cleanup pass (orchestrator)

### User input
"Clean up documentation only (no code changes) to remove inconsistencies, sloppy phrasing, and contradictions — while preserving authenticity and engineering voice. Reduce changes. Only fix correctness and clarity issues, this isn't rewrite rather tuning for submission."

### What I changed and why

- **AI_USAGE.md** — `getSession()` perf entry now explicitly notes the later revert and links to BUGS.md `8b14459`. Two `What's pending` lines became `Integration required`. `deploy-ops — pending` line replaced with description of the final inline-handled state.
- **REVIEW.md** — five empty `*pending:*` placeholders filled with the actual review content (drawn from BUGS.md and NOTES.md entries that already documented the work). Notes-core "pending — agent merge" pointer dropped because the post-impl review already lives further down the same file.
- **BUGS.md** — moved two stray cross-cut ops sentences out of the search bug entry into NOTES.md (they were misfiled, not bug findings). Normalized older `### [scope] Title (date)` headings to the standard `## [SEV] [scope] Title (commit X)` format documented at the top of the file. Content of each entry left unchanged.
- **NOTES.md** — added this entry per user request.

### What I deliberately did not change

- Tone, voice, or structure of any file.
- Any technical decision, log, or reasoning section.
- The "What we'd do with more time" / noisy neighbour sections.
- BUGS.md entry bodies — only headings normalized.
- AI_USAGE.md agent log entries — left as honest log, not summarized.

---

## 2026-04-28 — Audit log coverage for permission denials (orchestrator)

### User input (verbatim distrust signal)
"⨯ Error [NotesError]: You are not a member of this organisation. Don't we log such errors in audit_logs table?"

Followed by: "Log this in notes that i distrusted ai to implement all logs and reviewed implementation and asked to fix"

### Why this is the right kind of distrust to record

Logging is an area where agents (this one included) tend to ship the *visible* signal — `log.warn`, `log.error` — and skip the *durable* one — `audit()`. Both look like "logging" in code review at a glance, and the missing one is invisible in passing reads. The user surfaced this gap by inspecting an actual server-side error and asking the right question: is this in audit_log?

The answer was no. The `audit()` writer in `src/lib/log/audit.ts` had `permission.denied` declared in its `AuditAction` union — so the *intent* to persist denials was there — but no caller ever emitted the action. The earlier session that added `log.warn` to the three `assertCan*` helpers stopped at structured logs and never wired through to `audit()`. `requireMemberRole` in `notes/queries.ts` had no logging at all.

### What I changed
Added `audit({ action: "permission.denied", ... })` alongside the existing `log.warn` at four denial sites (BUGS.md `29a9f98`):
- `requireMemberRole` (queries.ts) — the path that produced the user's specific error. Two sub-cases: not-a-member, insufficient-role.
- `assertCanReadNote / assertCanWriteNote / assertCanShareNote` (permissions.ts).

Each row records the check name, the reason, the user, the org or note resource. A reviewer can `SELECT * FROM audit_log WHERE action = 'permission.denied'` and see actual denials.

### What this teaches about agent-generated logging in general
Three failure modes I've seen in this codebase:

1. **Visible-only logging**: agents ship `console.log` or `log.info` but no `audit()` call. Caught here.
2. **Structured-but-not-durable**: agents add `log.warn` to satisfy a "log permission denials" task literally, without asking whether the events should also persist. Caught here.
3. **Action type declared but never emitted**: someone (possibly a previous agent) reserved `permission.denied` in the `AuditAction` union, which is *worse* than not declaring it at all — it falsely signals to a reviewer that the persistence path exists.

For future agent work in this repo: logging tasks should produce both a structured log line AND, where the event is reviewable security or audit-relevant, an `audit()` call. The presence of an action type in `AuditAction` should be treated as a contract the implementation must honour.

---

## 2026-04-28 — `claude-hooks` module v1 (orchestrator)

New module `agent/claude-hooks` — Claude Code → Notes-App memory bridge. Files: `.claude/settings.json`, `.claude/hooks/{_lib,bootstrap,checkpoint}.js`, `.claude/state/.gitignore`. Spec from product: one agent session ↔ one note, one checkpoint ↔ one new note version.

### Hook map (after reading the official hooks reference)

| Event | Matcher / `if` | Script | Why |
|---|---|---|---|
| `SessionStart` | (any source: `startup`/`resume`/`clear`/`compact`) | `bootstrap.js` | Loads org guidelines + last checkpoint. Subsumes the originally-spec'd `PostCompact` — `SessionStart` already fires after a compact with `source=compact`. |
| `PostToolUse` | `matcher: "Bash"`, `if: "Bash(git commit *)"` | `checkpoint.js` | The `if` field gates at the matcher layer using permission-rule syntax — script no longer parses `tool_input.command`. |
| `PreCompact` | — | `checkpoint.js` | Snapshot before context loss. |
| `SessionEnd` | — | `checkpoint.js` | **Replaced `Stop`.** Per docs, `Stop` fires every turn (after every assistant response) — that would mint a checkpoint per turn. `SessionEnd` fires once when the session terminates, which is what "save on stop" actually means. |

`bootstrap.js` emits structured `hookSpecificOutput.additionalContext` JSON rather than plain stdout — keeps the bootstrap text out of the visible transcript while still injecting it into Claude's context.

### Why session-state lives on disk
Each hook process is a fresh `node` invocation. `bootstrap` writes `sessionNoteId` to `.claude/state/<claude_session_id>.json`; `checkpoint` reads it. Keyed by Claude's `session_id` from hook input — survives across hooks within one session, isolates across concurrent sessions.

### Server-side contract (not yet built)
`POST /agent/bootstrap` and `POST /agent/sessions/:id/checkpoint` need to be implemented in the notes app. Mapping to existing primitives:

- **Auth**: `MEMORY_AGENT_TOKEN` is a Bearer token. Should resolve to a service principal scoped to one org. Resist the urge to use the service-role Supabase client — go through the standard auth path so RLS still applies.
- **Note as session**: `notes` row keyed by `(org_id, agentId, repo, branch)`. Bootstrap = upsert (create if absent, return existing). Title format suggestion: `agent:<repo>@<branch>` with `agentId` in metadata.
- **Version as checkpoint**: each `/checkpoint` POST appends a `note_versions` row whose body renders the payload (event/done/next/issues/decisions/lastCommit) as markdown.
- **Resume**: `latestCheckpoint` in the bootstrap response = body of the most recent `note_versions` row for that note.
- **Guidelines**: org-level text. Cleanest place is a designated note (e.g., a singleton tagged `agent-guidelines` in the org), or an `orgs.agent_guidelines` column. Bootstrap returns its current contents.
- **Audit**: every bootstrap/checkpoint should `audit()` with action types like `agent.session.bootstrap` and `agent.session.checkpoint`. Add to the `AuditAction` union; emitting without declaring (or vice versa) is the failure mode flagged in the previous note.
- **RBAC**: bootstrap/checkpoint must enforce that the token's principal has write access to the target org. App-level check at the action site (per CLAUDE.md rule 6) PLUS RLS as the actual boundary.

### Failure modes the hooks intentionally swallow
- Missing `MEMORY_AGENT_TOKEN` → stderr line, no crash. Don't break the parent Claude Code session because the memory backend is down.
- API non-2xx → stderr line, no crash. Same reason.
- `checkpoint` with no prior `bootstrap` for the session → stderr line, skip. (Edge case: hooks added mid-session, or state file deleted.)

### Open questions for v2
- Should `done`/`next`/`issues`/`decisions` be auto-extracted from transcript via a Stop-hook summarization step? v1 leaves them empty (per spec: "no complex summarization").
- Should `SubagentStop` also checkpoint? Probably yes for parallel-agent visibility, but only if the subagent did meaningful work — needs a heuristic.
- `CwdChanged` could re-bootstrap if the user `cd`s into a different repo within one Claude session. Not in v1.

### Server-side implementation (same day, follow-up)

Added the routes the hooks call:
- `POST /agent/bootstrap` — `src/app/agent/bootstrap/route.ts`
- `POST /agent/sessions/[id]/checkpoint` — `src/app/agent/sessions/[id]/checkpoint/route.ts`

Routes mounted **outside** `/api/` so the URLs match the hook scripts (`MEMORY_API_URL` + `/agent/...`). `src/lib/supabase/middleware.ts` publicPaths now includes `/agent/` so the auth gate doesn't redirect Bearer-token requests to `/sign-in`. The route handlers do their own Bearer auth.

**Auth model**: single env-configured Bearer token bound to a fixed `(MEMORY_AGENT_ORG_ID, MEMORY_AGENT_USER_ID)` principal — `src/lib/agent/auth.ts`. Token compared with `timingSafeEqual`. The configured user must still be a member of the configured org on every call (so revoking the membership locks the agent out without an env change). All three env vars are optional in `src/lib/env.ts`; if any is missing the routes return 503 (`INTERNAL`) and the hooks log to stderr.

**Schema**: one new table `agent_sessions(org_id, note_id, agent_id, repo, branch, created_at, last_seen_at)` with `UNIQUE(org_id, agent_id, repo, branch)` and `INDEX(note_id)` — `src/lib/db/schema/agent.ts`. Migration `drizzle/0004_agent_sessions.sql` is hand-written (matches the project's convention for migrations that need RLS hardening: 0001/0002/0003 are all hand-written, only 0000 is drizzle-kit-generated). Decided **not** to run `db:generate` because the project keeps RLS-enabled tables under hand-written SQL; running generate produced a colliding `0001_*` filename which I reverted. Note for future contributors: don't `db:generate` unless you also handle the RLS lockdown.

**Mapping decisions**:
- Session note title: `Agent: <repo> @ <branch>` (human-readable; identity key lives in `agent_sessions`, not the title — title can be edited without breaking resume).
- Session note `visibility: "org"` so the team can see agent activity in the regular notes UI.
- Each `/checkpoint` POST opens a transaction: appends `note_versions` row, bumps `notes.current_version`, replaces `notes.content` with the latest checkpoint markdown, touches `agent_sessions.last_seen_at`. Reading the note shows the current state; the version trail is the history.
- `change_summary` on each version encodes `<event> @ <commit-sha>` so the existing notes-history UI is useful for browsing checkpoints.
- Org guidelines = a designated note in the org titled exactly `Agent Guidelines`. No schema change. Org admins author it via the regular notes UI. If absent, bootstrap returns empty string.

**Audit**: three new action types in `AuditAction` union — `agent.session.bootstrap`, `agent.session.checkpoint`, `agent.session.auth.fail`. Per the `permission.denied` lesson in the prior NOTES section, each is both declared in the type AND emitted at every call site. Auth failures are audited even though the principal is unknown — that's what `userId` being nullable in `audit_log` is for.

**Validation envelope**: routes use `toResponse(ok(...))` / `toResponse(err(...))` from `lib/validation/result.ts` — same shape every other route returns. The hook scripts only check `res.ok` (HTTP 2xx) and `result.data.{sessionNoteId, guidelines, latestCheckpoint}` — they're agnostic to the envelope wrapper but it's there if a future hook wants to surface validation errors.

**RLS trade-off** — see `BUGS.md` (`[KNOWN] RLS bypassed on /agent/* writes`). The Bearer-token path uses the Drizzle `db` client, which connects as the `postgres` role and bypasses RLS. The token IS the auth boundary on that path. v2 plan: provision a Supabase service-account user, sign in programmatically from the route, and route writes through `@/lib/supabase/server` so RLS stays the actual boundary. v1 ships the deviation deliberately to avoid the auth complexity for the take-home demo.

**Verified**:
- `npx tsc --noEmit` clean.
- `npx next lint` clean.
- `npx next build --no-lint` clean; both routes register as dynamic (`/agent/bootstrap`, `/agent/sessions/[id]/checkpoint`).
- Hook smoke-tests (token unset, no session) fail cleanly via stderr without crashing the parent.

**Not verified** (no DB available in worktree):
- Migration `0004_agent_sessions.sql` against a real Postgres.
- End-to-end bootstrap → checkpoint round-trip with a live Supabase instance.

---

## 2026-04-29 — `notes-mcp` module v1 (orchestrator)

New module `agent/notes-mcp` (worktree branched off `agent/claude-hooks` so the agent_sessions schema, env vars, and audit types are inherited). Adds an MCP server at `POST/GET/DELETE /mcp` so any MCP-aware client (Claude Code, Claude Desktop, Cursor, etc.) can read and write the org's notes interactively.

### Why MCP and not "more REST endpoints"

The hooks bridge gives the agent **memory** — it injects context at session start and writes versions on lifecycle events. But the model can't *query* the notes app mid-conversation through hooks; they're fire-and-forget. MCP is the protocol the model uses to call tools the same way it calls Bash or Read. Adding an MCP server turns the notes app from a passive write target into an interactive memory the model can search and update.

### SDK + transport choice

- `@modelcontextprotocol/sdk@1.29.0`. Latest as of this branch.
- Transport: `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`. Takes a Web `Request`, returns a `Response` — drops straight into a Next.js Route Handler with no Node-shim. SDK author calls this out as the right transport for Cloudflare Workers / Hono / Next, exactly our shape.
- Stateless mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). Every request builds a fresh `McpServer` + transport, uses them once, and closes both in `finally`. No shared state means horizontal scale needs no sticky sessions and no Redis.

### Auth model

Reuses `requireAgentPrincipal` from `src/lib/agent/auth.ts` — same `MEMORY_AGENT_TOKEN` that the hooks bridge uses, same single-(org, user) principal binding, same `timingSafeEqual` check, same live org-membership re-verification on every call. No new auth surface to design or operate.

The principal flows into the MCP server through closure: `createMcpServer(principal)` builds the server, and every tool/resource handler closes over `principal`. No per-call argument passing, no chance of accidental cross-org leakage from a forgotten parameter.

### Tools and resources

Files: `src/lib/mcp/{server,tools,resources,audit,format,index}.ts`, route at `src/app/mcp/route.ts`.

Five tools (`whoami`, `search_notes`, `list_recent_notes`, `get_note`, `create_note`) and two resources (`notes://recent`, `notes://note/{noteId}`). Every implementation calls into existing notes-core helpers (`searchNotes`, `listNotesForUser`, `getNoteDetailForUser`, `createNote`) — zero query duplication. The helpers already enforce permission via `requireMemberRole` / `assertCanReadNote` / `assertCanWriteNote`, so the MCP path inherits the same access checks that the web UI gets.

`NotesError` thrown from a helper is converted to an `isError: true` tool result with the code prefix (e.g. `FORBIDDEN: ...`). The model sees a clean string, not a stack trace. Resources surface errors as JSON payloads with an `error` key since resources have no `isError` flag in the protocol.

### Audit

Every tool call emits one `mcp.tool.call` row (success) or `mcp.tool.error` row (failure) with `durationMs` and a small per-tool metadata bag — `noteId` for `get_note`, `hasQuery` for `search_notes`, etc. Resources do the same with `mcp.resource.{read,error}`. The audit wrapper (`src/lib/mcp/audit.ts`) makes this consistent across handlers — adding a new tool can't accidentally skip auditing.

Action types added to the `AuditAction` union: `mcp.tool.call`, `mcp.tool.error`, `mcp.resource.read`, `mcp.resource.error`, `mcp.auth.fail`. Per the lesson logged at commit `29a9f98` (declared types must be emitted at call sites), each is wired up in code, not just typed.

### Middleware

`/mcp` added to `publicPaths` in `src/lib/supabase/middleware.ts` so the auth gate doesn't redirect Bearer-token requests to `/sign-in`. Same pattern as `/agent/`.

### What this enables today

After deploy + token configuration, an operator can `claude mcp add --transport http notes-app https://app/mcp --header "Authorization: Bearer $TOKEN"` and Claude Code will see `whoami / search_notes / list_recent_notes / get_note / create_note` as callable tools alongside its native ones. Asking "what did I write about X last week" triggers a real search; "save this as a new note" triggers a real write — both audited, both bound to the configured org.

### Open questions for v2

- **OAuth 2.1 vs Bearer**: MCP spec recommends OAuth 2.1 with dynamic client registration. v1 ships Bearer because the agent-token model is already deployed for `/agent/*` and adding OAuth doubles the auth surface. Worth revisiting if we want multi-tenant tokens (one token per dev) instead of a single env-bound principal.
- **Streaming tool results**: long-running tools could benefit from SSE (`enableJsonResponse: false`). v1 keeps JSON because all current tools complete in <1s and the deploy story stays simpler.
- **Resource subscriptions**: the SDK supports `subscribe` so clients can be notified when a resource changes. Could power "tell me when a new note is created" flows. Out of scope for v1.
- **Update / delete tools**: `create_note` is the only writer. Adding `update_note` and `delete_note` is straightforward (the helpers exist) — defer until there's a demonstrated need to avoid surface-area bloat in the LLM's tool list.
- **Same RLS deviation as `/agent/*`**: tools call `db`-backed helpers, no Supabase auth session, same trade-off documented in `BUGS.md` (`[KNOWN] RLS bypassed on /agent/* writes`). Fix plan applies identically — any v2 work to programmatic Supabase auth lifts both paths together.

### Verified

- `npx tsc --noEmit` clean
- `npx next lint` clean
- `npx next build --no-lint` clean — `/mcp` registers as dynamic alongside `/agent/*`
- One typecheck error caught and fixed: `note.shares[].user.id` → `note.shares[].sharedWith.id` (NoteShareRecord uses `sharedBy` / `sharedWith`, not `user`)

### Not verified (no DB available)

- An actual MCP client connecting and listing tools/resources via the live `/mcp` endpoint.
- Round-trip of `create_note` → `search_notes` returning the new row.
- Behaviour under load / multiple concurrent client sessions.

---

## 2026-04-29 — `agent/identity` module v1 (orchestrator)

Two features in one branch — both reshape the agent identity surface so it's manageable per-org rather than env-bound, and so subagent activity is captured with provenance.

### Why "identity" and not two separate branches

The two pieces share a single concept: **who is acting on the agent path, and how do we know**. Token management answers "which token authenticated this request" and "which org member is the principal." Subagent tracking answers "is this the main agent or a sub-agent, and which kind." The audit record now has a clean tuple — `(orgId, userId, tokenId, agentId, agentType)` — that uniquely identifies any agent action.

### Phase 1 — Token management

**Schema:** `agent_tokens(id, org_id, user_id, name, token_prefix, token_hash, created_by, created_at, last_used_at, revoked_at)` with `UNIQUE(token_hash)` and a partial index `(org_id) WHERE revoked_at IS NULL` for "list active tokens" queries. Migration `drizzle/0005_agent_tokens.sql` is hand-written (RLS-table convention, same as 0001-0004).

**Token format:** `nat_<32 hex>`. The 32 hex digits give 128 bits of entropy. Stored as sha256 hex. The first 8 chars of the random suffix are kept in clear as `token_prefix` for UI display ("nat_a1b2c3d4… last used 2h ago") so we don't need to round-trip the secret.

**Auth refactor:** `requireAgentPrincipal` tries the token table first, then env vars. Token-shape detection (`isWellFormedToken`) decides which path to try — a `nat_*` token never falls through to env even if the table miss would otherwise be ambiguous. The token's `last_used_at` is bumped best-effort (`void db.update(...).catch()`) so a transient DB write failure doesn't tank the request. Env path is kept as v0 backward compat.

**`AgentPrincipal` shape changed:** added `tokenId` (uuid or null for env path) and `tokenName` (string, "env" for env path). Threaded through every existing audit-emitting site: `bootstrap()`, `checkpoint()`, `/agent/search`, and `withAudit` in `src/lib/mcp/audit.ts`. Every audit row from this branch onward carries token provenance.

**UI:** `/orgs/[orgId]/settings` gained an "Agent Tokens" section visible to owners/admins only. Server actions `handleCreateAgentToken` / `handleRevokeAgentToken` follow the existing redirect-with-flash pattern. The cleartext-once-shown UX uses a short-lived path-scoped HttpOnly cookie (`agent_token_just_created`, 60s, path-restricted to `/orgs/[orgId]/settings`) that the page reads and clears on render. Cleartext never appears in URLs, history, or referrer headers.

**Audit:** new types `agent.token.create`, `agent.token.revoke`. Per the lesson at commit `29a9f98`, both are emitted at their call sites in `src/lib/agent-tokens/crud.ts`, not just declared.

### Phase 2 — Subagent tracking

**Hook input plumbing:** Per the [hooks reference](https://code.claude.com/docs/en/hooks), `agent_id` and `agent_type` are populated only when a hook fires inside a sub-agent. New helper `subagentContext()` in `_lib.js` extracts them, returning `null` for the main agent. Documented as such so future hook scripts know what `null` means.

**`/agent/sessions/:id/event` endpoint:** Lightweight audit-only writer. POSTs append an `audit_log` row with the principal + agent metadata but NO `note_versions` row. This is the key design call — high-frequency events (every MCP tool call by a subagent) would explode the version history if checkpointed. Audit log is the right home; versions stay reserved for coarse session-state snapshots.

**Audit kinds:** `agent.event.subagent.start`, `agent.event.subagent.stop`, `agent.event.subagent.tool.call`. Mapped 1:1 from the input `kind` to keep the schema flat.

**Hook events wired:**
- `SubagentStart` → `event.js` → `subagent.start` (records agent_id/agent_type at spawn time)
- `SubagentStop` → `event.js` → `subagent.stop`
- `PostToolUse` matcher `mcp__notes-app__.*` → `event.js` → `subagent.tool.call` (also fires for the main agent's MCP tool calls — same audit kind, just with `agentId: null`. The audit reader can filter for `metadata.agentId IS NOT NULL` if they only want subagent activity.)

### MCP <-> hook audit duality

The MCP server side of `mcp.tool.call` audit rows knows: `(orgId, userId, tokenId, tokenName, toolName, durationMs)`. It does NOT know `agentId` / `agentType` because the MCP wire protocol carries no subagent context — Claude Code sends standard JSON-RPC.

The hook side (`PostToolUse` mcp matcher → `event.js`) knows: `(agentId, agentType, toolName, durationMs)`. So one MCP tool call by a subagent produces TWO audit rows:

1. `mcp.tool.call` with full token provenance, no agent provenance
2. `agent.event.subagent.tool.call` with agent provenance

Correlated by `(orgId, toolName, ~timestamp)`. Documented this duality so future readers don't think it's an oversight.

### Verified

- `npx tsc --noEmit` clean across all new/modified files
- `npx next lint` clean
- `npx next build --no-lint` registers `/agent/bootstrap`, `/agent/search`, `/agent/sessions/[id]/checkpoint`, `/agent/sessions/[id]/event`, `/mcp`. The settings page bundle grew from 739 B to 1.19 kB — the new `created-token-banner.tsx` client component
- `event.js` smoke-tests: SubagentStart attempts API call, SessionEnd is silently ignored (correct — not in the classify allowlist)

### Open v2 work (deferred)

- **Token list pagination:** `listAgentTokens` returns the full list with no limit. Fine at v1 token volumes (a handful per org). Add cursor pagination if any org grows past ~50 tokens.
- **Token-level scopes:** every token currently authorises every `/agent/*` and `/mcp` call. Future enhancement: per-token capability flags (`bootstrap-only`, `read-only`, `mcp-write-only`).
- **Subagent-aware MCP audit:** if Claude Code ever exposes subagent context through MCP (e.g. via `_meta` or a custom header), the `mcp.tool.call` row should pick it up directly and the duplicated event row becomes redundant.
- **RLS on `agent_tokens`:** same `[KNOWN] RLS bypassed` deviation as `agent_sessions`. The v2 fix-plan in BUGS.md applies — programmatic Supabase auth lifts all three Bearer-token tables together.

---

## 2026-04-30 — Timeline page + MCP update_note (orchestrator)

### Timeline feature — commit `102cd1c`

Added `/orgs/[orgId]/timeline` — an org-scoped activity feed backed by `audit_log`. Files: `src/app/orgs/[orgId]/timeline/page.tsx`, `src/app/orgs/[orgId]/timeline/loading.tsx`, `src/lib/timeline/queries.ts`.

**Query design:** `getOrgTimeline` joins `audit_log → users` and batch-loads note titles from `notes` for any row where `resourceType='note'` or `action.startsWith('ai.summary.')` with a `noteId` in metadata. Soft-deleted notes surface as struck-through titles rather than broken links. One query + one batch load = two round-trips regardless of page size.

**Metadata rendering:** Previous implementation fell through to the raw action string for `search.execute`, `mcp.tool.*`, `mcp.resource.*`, and `agent.event.*`. Each now renders real fields:

| Action | Fields shown |
|---|---|
| `search.execute` | query text, result count, latency ms, page |
| `mcp.tool.call/error` | tool name (from `resourceId`), token name, duration ms or error |
| `mcp.resource.read/error` | resource name, token name, duration ms or error |
| `agent.event.subagent.start/stop` | agent type, token name, agentId (first 8 chars) |
| `agent.event.subagent.tool.call` | tool name, agent type, token name |

**Why this matters:** The audit log rows are already rich — `search.execute` has `q`, `resultCount`, `latencyMs`; MCP rows have `tokenName`, `durationMs`; agent event rows have `agentType`, `toolName`. Showing only a label discarded that data at render time for no reason.

### MCP `update_note` tool — unstaged in `src/lib/mcp/tools.ts`

Wired `updateNote` from `@/lib/notes` as a new MCP tool. Allows the model to evolve a session note in place rather than creating a new note per change. Every call increments `currentVersion` and records a snapshot in version history. `withAudit` wraps it so every update produces a `mcp.tool.call` audit row with `noteId` + `contentLength` in metadata.

### Session log workflow established

Going forward: `create_note` only at session start (when no session note exists). All subsequent changes use `update_note` on the existing session note. Rationale: one note per session with an evolving version trail is more navigable than a new note per change.

---

## 2026-04-30 — Per-note timeline (feat/note-timeline)

### Decision: schema change allowed from orchestrator context

`src/lib/db/schema/**` is frozen for module agents in isolated worktrees. The orchestrator (main branch, coordinating context) can add non-breaking additions — an index does not alter any column, type, or RLS policy, and requires no migration coordination with other modules.

### Index: `audit_log_resource_idx` — migration `0006_audit_resource_idx.sql`

Added `(resource_type, resource_id)` composite index on `audit_log`. Without it, a per-note timeline query lands on `audit_log_org_created_idx` and filters `resource_id` in memory — fine for a demo, but linear in org event volume. The new index makes per-note queries O(note events) regardless of org size.

### Query: `getNoteTimeline`

Reuses `TimelineEvent` from `getOrgTimeline`. Two-condition WHERE:
- `(resource_type = 'note' AND resource_id = noteId)` — hits the new index directly
- `action LIKE 'ai.summary.%' AND metadata->>'noteId' = noteId` — catches AI summary events that store noteId in metadata rather than resourceId (same pattern as the org timeline)

### Page: `notes/[noteId]/timeline/page.tsx`

Scoped EventDescription — no note links (already on the note). Day-grouped identical to org timeline. Tab added to the note layout alongside Note / AI Summary / History.

### Cleanup note

The `and`/`or`/`sql` imports added to `queries.ts` are the only new drizzle symbols; no new dependencies.

---

## 2026-04-30 — Per-note timeline: agent/MCP event visibility + rich metadata (orchestrator)

### Problem

Two bugs in the per-note timeline (`notes/[id]/timeline`):

1. **Query gap**: `getNoteTimeline` only joined by `resource_type='note' AND resource_id=noteId` or `action LIKE 'ai.summary.%'`. MCP tool calls (`get_note`, `update_note`) are stored as `resource_type='mcp'` with `metadata.noteId` — they were invisible.

2. **UI gap**: `getActionMeta` and `EventDescription` in the per-note timeline had no branches for `mcp.*`, `agent.event.*`, `agent.session.*`, `search.execute` — all fell through to raw action text.

### Fix

- `src/lib/timeline/queries.ts`: replaced the two-clause OR with a generalised `metadata->>'noteId' = noteId` second branch (covers ai.summary.*, mcp.tool.*, and any future event that embeds noteId in metadata). Also simplified `resolvedNoteId` mapping.
- `src/app/orgs/[orgId]/notes/[noteId]/timeline/page.tsx`: added icon + colour entries for all mcp/agent/search actions; added full `EventDescription` branches matching the org-wide timeline.

---

## 2026-04-30 — Checkpoint: include commit body in session note (orchestrator)

### Motivation

Checkpoint entries only captured the commit subject line. The commit body
(description, Co-Authored-By, etc.) was silently dropped, making the session
note too sparse to serve as a meaningful feature log.

### Changes

- `src/lib/agent/schemas.ts`: added `body` field to `checkpointSchema` (optional, max 5000 chars).
- `src/lib/agent/sessions.ts`: `renderCheckpoint` now emits a `### Summary` section when `body` is non-empty.
- `.claude/hooks/checkpoint.js`: after parsing subject + SHA from tool_response, runs `git log -1 --pretty=%b` in the worktree CWD to fetch the body and includes it in the checkpoint API call.

### Convention

Writing a descriptive commit message body is now the natural way to get a
feature summary into the notes-app session note — no separate MCP call needed.

---

## 2026-04-30 — Tighten checkpoint.js parsing (orchestrator)

### Problem

Three weak spots in the commit checkpoint hook:

1. `tool_response` extraction assumed `{ output: string }` shape. Claude Code may also
   emit a string directly, or `{ content: [{type:"text", text:string}] }` — both fell
   through to `""`, so `parseCommitOutput` always got an empty string.

2. `extractCwd` regex only handled double-quoted paths. Single-quoted (`cd 'path' &&`)
   and bare (`cd /path &&`) paths returned null, falling back to the main repo CWD.

3. `parseCommitOutput` branch-name character class `[\w/.\-]+` excluded valid chars
   (e.g. parentheses in merge commits like `main (HEAD)`), causing no-match failures.

### Fix

- `extractOutput(toolResponse)`: tries `string` → `.output` → `.content[0].text` in order.
- `extractCwd(command)`: regex now handles double-quoted, single-quoted, and bare paths.
- `parseCommitOutput(output)`: branch name now matched with `\S+` (any non-whitespace).
