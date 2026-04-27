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

## 2026-04-26 — files module outcome (`Galileo`, `agent/files`)

### Reasoning summary

- Stayed inside the owned files surfaces only.
- Kept note-detail attachment UI out of scope because `/notes/[id]` belongs to
  `notes-core`; surfaced optional note attachment from the org files screen
  instead.
- Used signed upload/download flows and permission checks instead of expanding
  baseline contracts.

### Verification summary

- `git diff --check` passed.
- Type-checking could not run in this worktree because local `tsc` is missing.

## 2026-04-27 — Files: note-scoped upload with 5-file cap (orchestrator)

### What was built
- `src/lib/files/index.ts` — added `countFilesForNote`, `getFilesForNote`, `MAX_FILES_PER_NOTE = 5`. Cap enforced in `createUpload`: checks count before issuing signed URL, throws `UNPROCESSABLE` if at limit.
- `src/lib/files/validation.ts` — added `noteFilesQuerySchema`.
- `src/app/api/files/route.ts` — GET now accepts `?noteId=` for note-scoped file list; `?orgId=` path unchanged.
- `src/app/orgs/[orgId]/files/_components/note-file-uploader.tsx` — client component showing attached files, upload picker (multi-select, disabled at cap), X/5 counter, download + remove per file.

### Cross-module boundary
`NoteFileUploader` is ready to be imported by notes-core's note create/edit forms:
```tsx
import { NoteFileUploader } from "@/app/orgs/[orgId]/files/_components/note-file-uploader";
// render after the note form body:
<NoteFileUploader noteId={noteId} orgId={orgId} canWrite={isAuthor || isAdmin} />
```
Notes-core owns `src/app/orgs/[orgId]/notes/**`. Integration into those forms requires a notes-core commit. The component is self-contained and safe to import.

### Decisions
- Cap is enforced server-side (count query before signed URL). UI disables the picker as a UX convenience, not a security control.
- `getFilesForNote` joins memberships + noteShares to re-use the same `canReadAttachedNote` visibility logic as `listFilesForOrg`. No duplicated access logic.
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

### Step 5: rate limiting

- Added `src/lib/ai/rate-limit.ts`.
- Implemented the required in-memory per-user token bucket at 5 requests per 60 seconds.
- Stored limiter state on `globalThis` so development reloads do not reset the bucket on every module reload inside the same server process.

### Step 6: generation route

- Added `POST src/app/api/ai/notes/[noteId]/summary/route.ts`.
- The route uses:
  - `getCurrentUser` for typed unauthenticated responses
  - `assertCanReadNote` before loading note content
  - the in-memory limiter before the expensive LLM call
  - a pending `ai_summaries` row before generation
  - `audit()` for request, fallback, complete, and fail events
- The frozen schema requires non-null `provider` and `model` on pending rows. To avoid changing the shared schema, the route inserts a pending row with `provider='anthropic'` and `model='pending'`, then updates those fields with actual values on success or final failure.
- On total provider failure, the route records `status='failed'`, saves a combined provider failure message into `error_message`, and returns the standard `UPSTREAM` error envelope.

### Step 7: summary UI and acceptance flow

- Added a standalone summary page under `src/app/orgs/[orgId]/notes/[noteId]/summary/page.tsx` because notes-core has not yet provided a parent note detail route in this worktree.
- The page explicitly calls `assertCanReadNote` before reading note content or summaries, which is required because org-level layout access is not sufficient for `private` and selectively shared notes.
- Added a client-side generate button that calls the required API route and refreshes the page on success.
- Added a server action for acceptance inside the owned summary path:
  - validates `orgId`, `noteId`, `summaryId`, and field list with zod
  - calls `assertCanWriteNote`
  - writes the selected top-level subset into `accepted_fields`
  - sets `status='accepted'`
  - audits `ai.summary.accept`

### Step 8: verification

- `git diff --check HEAD~6..HEAD` passed with no whitespace or merge-marker issues.
- `git status --short` is clean after the scoped feature commits.
- Compiler verification is currently blocked in this worktree:
  - `npm run typecheck` invoked `tsc --noEmit`
  - the shell reported `tsc: command not found`
- Manual review covered:
  - owned-path boundaries
  - prompt delimiter isolation
  - permission checks before note reads and summary acceptance
  - audit coverage for `request`, `fallback`, `complete`, `fail`, and `accept`

## 2026-04-27 — AI Summary: visible navigation + search helper (orchestrator)

### What was built
- `src/app/orgs/[orgId]/notes/[noteId]/layout.tsx` — new layout wrapping both the note detail page and the summary page with "Note" / "AI Summary" tab navigation. Additive: doesn't touch notes-core's `page.tsx`.
- `src/lib/ai/summary-search.ts` — `getSummaryMatchingNoteIds(orgId, term)` queries `ai_summaries.structured` JSONB for term matches in `tldr` and `keyPoints` via Postgres `->>'tldr'` and `->'keyPoints'` operators.

### Cross-module boundary (search integration)
Notes-core's `listNotesForUser` (`src/lib/notes/crud.ts`) must import and call `getSummaryMatchingNoteIds` to extend search to summary text:
```typescript
import { getSummaryMatchingNoteIds } from "@/lib/ai/summary-search";

// inside listNotesForUser, when term is present, extend the OR filter:
const summaryNoteIds = term ? await getSummaryMatchingNoteIds(orgId, term) : [];
// add to accessCondition or the OR:
summaryNoteIds.length ? inArray(notes.id, summaryNoteIds) : undefined,
```
This is the only remaining cross-module dependency for full search coverage.

### Decisions
- Layout approach chosen over modifying notes-core's `page.tsx` — the layout wraps child routes transparently, avoids merge conflicts with notes-core.
- JSONB text search via `ilike((structured->>'tldr'), %)` — simple and consistent with the existing `ilike` search pattern on title/content. Avoids adding a new tsvector column to the schema.
- Split service.ts into 4 focused modules: `queries.ts` (internal helpers), `crud.ts` (list/detail/create/update/delete), `shares.ts` (upsert/remove), `history.ts` (version snapshots).
- Baked two bug fixes directly into the right commits rather than adding fix-commits on top:
  - `isRedirectError` rethrow → inside server actions (not a separate fix commit)
  - `SELECT ... FOR UPDATE` + 23505→CONFLICT mapping → baked into crud.ts and shares.ts
  - Soft-delete no longer writes a redundant version row
- Route handlers split 1-per-concern: list/create, detail/update/delete, shares, history
- UI split: components.tsx → actions.ts → list page.tsx → detail page.tsx → history page.tsx

### Outcome
18 commits from dc9941f to 68caf28, each reviewable in isolation.


## 2026-04-26 — org-admin implementation (Planck worktree)

### What happened
- Planck (Codex agent) committed 3 WIP entries that contained only doc updates and a stale Drizzle migration (0000_*.sql) — which violates the frozen contract on drizzle/ files. No actual product code was shipped.
- Discarded all 3 WIP commits (git reset --hard f09bf47), then implemented org-admin from scratch.

### Architecture decisions
- Split service layer into focused single-responsibility files: create.ts / invite.ts / roles.ts / members.ts — one file per concern, mirrors the notes-core split pattern. Each is its own commit.
- `createOrg` uses the Drizzle `db` client directly (service-role equivalent via DATABASE_URL) because the creator has no membership row yet at INSERT time — RLS on memberships would block a user-scoped client.
- `inviteMember` stores the invite link in audit_log as the primary delivery mechanism. Email sending is left as a configurable hook (log.info shows the link; when EMAIL_DESTINATION is wired, the function extends here).
- `acceptInvite` checks email match server-side and returns FORBIDDEN with a sign-out option — not just a client-side guard.
- `changeRole` last-owner guard: counts owners AFTER the proposed change conceptually; if `count(role='owner') <= 1` and target is being demoted from owner, return 422.
- Org switcher is a client component that sets only an informational cookie — auth always uses URL [orgId] segment, never the cookie for permission decisions.

### What's still missing (nice-to-have)
- Org name/slug edit on the settings page (read the spec again — not required for this build)
- Email send integration when EMAIL_DESTINATION env is set


## 2026-04-26 — Runtime bug fixes (post-PR-raise)

### Bugs found during manual testing

**1. 23503 FK on orgs.created_by**
- Cause: auth.users exists but public.users mirror row does not (trigger only fires on INSERT into auth.users; dev/dashboard users pre-date the migration).
- Fix: upsert public.users row at the start of createOrg transaction (onConflictDoNothing). Commit a67a74b on agent/org-admin.

**2. pino "the worker has exited"**
- Cause: pino transport option spawns a worker_thread; Next.js dev server recycles workers between requests, killing it mid-flight.
- Fix: use pino-pretty as synchronous stream (pino(opts, stream)) in dev instead of transport. No worker thread. Production path unchanged. Commit ea2eedd on main.

**3. toResponse() in server actions**
- Cause: server actions returned toResponse(ok({id})) — a NextResponse object. Page reads result.ok (NextResponse.ok = true for 2xx) then crashes on result.data.id because NextResponse has no .data field.
- Fix: stripped toResponse() from all three org-admin action files. Server actions return raw Result<T>. Commit 307c381 on agent/org-admin.

### Design rule clarified
- toResponse() → route handlers only (converts Result<T> to HTTP response for JSON API callers)
- Raw Result<T> → server actions (returned directly, page reads .ok / .data / .error)


## 2026-04-26 — isRedirectError fix (post-merge)

- PR for notes-core was merged before the `isRedirectError` fix landed on the branch.
- Fix cherry-picked from db1b195 → d67fdb9 directly onto main.
- Root cause: `next/dist/client/components/redirect` does not export `isRedirectError` as a public API in Next.js 15 — resolves to `undefined` silently, throws at call site.
- Replacement: inline digest check (`error.digest.startsWith("NEXT_REDIRECT")`) — version-agnostic, no internal import dependency.
- Rule going forward: never import from `next/dist/**` — those are internal bundle paths with no stability guarantees.

---

## 2026-04-26 — UI loading states (orchestrator)

### Problem

User flagged: navigation between pages renders blank until the server-component data resolves. Notes list, search, settings, etc. all do server-side data fetching with no fallback — looks frozen.

### Decision: route-level `loading.tsx` at the org segment, not per-module

App Router gives us `loading.tsx` for free — wraps the segment in a Suspense boundary, renders during data fetching, no client wiring needed. Two ways to apply it:

1. Per-module `loading.tsx` inside each module's route folder (`notes/loading.tsx`, `search/loading.tsx`, ...). Tailored fallbacks, but **crosses module ownership** — those paths are owned by the module agents per CLAUDE.md, and the orchestrator dropping files in there is exactly the kind of cross-boundary edit the rails forbid.
2. One `loading.tsx` at `src/app/orgs/[orgId]/loading.tsx`. The org layout is main-baseline territory (frozen contract). Next.js uses this as the fallback for **every** child segment until a module owner adds a more specific one. Generic skeleton, but no boundary crossing and module owners can override later without conflict.

Picked option 2. Plus a top-level `src/app/loading.tsx` for sign-in/orgs-index navigation.

### Added

- `src/components/ui/skeleton.tsx` — minimal shadcn-style `Skeleton` primitive (animated `bg-muted` div). Lives in shared UI (not module-owned).
- `src/app/loading.tsx` — root fallback, centered skeleton block.
- `src/app/orgs/[orgId]/loading.tsx` — three skeleton cards mimicking the notes/search/settings card layouts. `aria-busy` + `aria-live="polite"` + sr-only "Loading…" so it's announced, not silent.

### Verified

- `npx tsc --noEmit` — no new errors from these files (pre-existing errors in `lib/supabase/*`, `orgs/invite.ts`, etc. are unrelated).
- No module-owned paths touched. Module agents can drop their own `loading.tsx` later for tailored fallbacks; this baseline just removes the blank-screen footgun.

---

## 2026-04-27 — Per-module loading states + SubmitButton (parallel module agents)

### Problem

The org-segment `loading.tsx` only fires when navigating *into* the org. Once already inside the org, transitions to deeper segments (notes list → note detail → history, settings, search) still showed a blank screen. Server-action form submits (create note, save note, invite member, etc.) never trigger `loading.tsx` at all — they needed `useFormStatus`-based pending state on submit buttons.

### Decision

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
