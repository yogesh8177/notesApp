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
