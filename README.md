# Notes App

![CollabNotes hero infographic](./assets/infographic-79aa905e-01b1-425a-a5db-6b9921224540.png)

A multi-tenant team notes platform. Users belong to multiple organisations; each organisation has members, notes, files, and role-based permissions enforced end-to-end — from the UI down to Postgres row-level security.

## Features

- **Auth + multi-tenancy** — magic link / password sign-in via Supabase Auth. Users can create and switch between organisations. Role hierarchy: `owner → admin → member → viewer`.
- **Notes** — full CRUD with three visibility levels (`private`, `org`, `shared`). Selective per-user share grants with `view` or `edit` permission. Tag attachment.
- **Versioning + diffs** — every write creates an immutable version snapshot. History page shows who changed what and when. Line-level diff viewer between any two versions.
- **Search** — full-text search (`tsvector`) across titles and content, tag-prefix search (`#tag` via `pg_trgm`), and filter-only browsing (author, date range, visibility). All paths enforce org boundaries and permission visibility.
- **File uploads** — signed upload URLs (bytes go browser → Supabase Storage, never through the app server). Signed download URLs with short TTL. Cursor-paginated org file library. Up to 5 attachments per note.
- **AI summaries** — structured summaries generated with Anthropic Claude (OpenAI fallback). Streamed to the client. User explicitly accepts output before it is saved. Per-user rate limiting.
- **Audit log** — every auth event, mutation, AI call, permission denial, and failure is written to a persistent `audit_log` table via structured logging.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, React 19) |
| Language | TypeScript (strict) |
| Database | Supabase Postgres |
| Auth | Supabase Auth (magic link + password) |
| ORM | Drizzle ORM |
| Storage | Supabase Storage (private bucket, signed URLs) |
| AI | Anthropic Claude (primary) + OpenAI (fallback) |
| Logging | Pino structured logs + persistent audit table |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) |
| Deployment | Docker + Railway |

## Architecture

### Security model

Two independent enforcement layers:

1. **App-level checks** — `requireOrgRole` on every org layout, `assertCanReadNote` / `assertCanWriteNote` / `assertCanShareNote` at every mutation site. These produce good UX errors and early returns.
2. **Row-level security (RLS)** — Postgres policies in `drizzle/0002_rls_policies.sql` enforce tenant isolation and visibility at the database level regardless of which application code path reaches them. The service-role client (RLS bypass) is used only for admin operations: seed scripts, signed URL generation, trigger-equivalent inserts.

### Request flow

```
Browser
  └── Next.js middleware          ← auth gate, session refresh
       └── App Router layout      ← requireOrgRole (read pages)
            └── Server action     ← assertCan*(noteId, userId)
            └── Route handler     ← requireApiUser + zod validation
                 └── Drizzle ORM  ← parameterised queries
                      └── Supabase Postgres (RLS active)
```

### Module boundaries

Each feature is a self-contained module with its own lib, pages, and API routes:

```
src/lib/
  auth/         ← session, org membership, permission helpers
  notes/        ← CRUD, versioning, sharing, diff
  search/       ← FTS, tag-prefix, filter-only browse
  files/        ← signed upload/download, permissions
  ai/           ← prompt construction, provider abstraction, rate limiting
  orgs/         ← org creation, invites, role management
  log/          ← pino logger + audit() writer
  db/           ← Drizzle client, schema definitions
  validation/   ← Result<T, E> envelope, zod helpers
```

### Search architecture

Three code paths share the same base conditions (org boundary, visibility predicate, tag/author/date filters):

- `searchByFts(q)` — `plainto_tsquery` against `tsvector` column, ranked by `ts_rank`
- `searchByTag(#prefix)` — `pg_trgm` similarity against tag names, ordered by similarity
- `browseFiltered()` — no text query, ordered by `updatedAt DESC` (used when only filters are active)

### AI summary pipeline

```
User clicks "Generate"
  → POST /api/ai/notes/[noteId]/summary
  → assertCanReadNote
  → rate limit check (in-memory, per user)
  → fetch note content
  → build prompt (content delimited, no free interpolation)
  → stream from Anthropic (OpenAI fallback on error)
  → client renders streamed markdown
  → User clicks "Accept"
  → server action saves to ai_summaries table
  → audit log entry written
```

### Versioning model

Every `updateNote` call:
1. Opens a transaction and `SELECT ... FOR UPDATE` locks the note row
2. Reads `currentVersion`, computes `currentVersion + 1`
3. Inserts a new row in `note_versions`
4. Releases the lock

Concurrent writers are serialised — all writes succeed and receive monotonically increasing version numbers. No stale-edit rejection; version history is append-only.

## Project structure

```
.
├── drizzle/                    # SQL migrations (applied in order)
│   ├── 0000_*.sql              # Base schema
│   ├── 0001_extensions.sql     # pg_trgm, pg_vector extensions
│   ├── 0002_rls_policies.sql   # RLS policies + auth trigger
│   └── 0003_storage_policies.sql
├── scripts/
│   ├── db/migrate.ts           # Migration runner
│   └── seed/                   # 10k-note seed (factories + runner)
├── src/
│   ├── app/
│   │   ├── api/                # Route handlers (search, files, notes, AI)
│   │   ├── auth/               # Auth callback + sign-out
│   │   ├── orgs/
│   │   │   ├── [orgId]/
│   │   │   │   ├── layout.tsx  # Org auth gate (requireOrgRole)
│   │   │   │   ├── notes/      # Notes list, note detail, history, summary
│   │   │   │   ├── search/     # Search page
│   │   │   │   ├── files/      # File library + upload
│   │   │   │   └── settings/   # Org settings, member management
│   │   │   ├── new/            # Create org
│   │   │   └── invite/[token]/ # Accept invite
│   │   └── sign-in/
│   ├── components/
│   │   ├── org/                # OrgSwitcher
│   │   └── ui/                 # shadcn primitives
│   └── lib/
│       ├── auth/               # session, org, permissions
│       ├── ai/                 # prompt, provider, rate-limit, schema
│       ├── db/                 # Drizzle client + schema
│       ├── files/              # Upload, download, permissions
│       ├── log/                # Pino logger + audit writer
│       ├── notes/              # CRUD, diff, history, shares
│       ├── orgs/               # Create, invite, roles, members
│       ├── search/             # FTS + filter service
│       ├── supabase/           # Browser, server, service clients
│       └── validation/         # Result<T,E> envelope
├── Dockerfile
├── railway.toml
└── .env.example
```

## Local setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier is fine)
- Anthropic API key (OpenAI key optional — used as fallback)

### 1. Clone and install

```bash
git clone <repo>
cd notes-app
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API (secret) |
| `DATABASE_URL` | Supabase Dashboard → Project Settings → Database → Connection pooler (Transaction mode) |
| `DIRECT_URL` | Supabase Dashboard → Project Settings → Database → Direct connection |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |

### 3. Run migrations

```bash
npm run db:migrate
```

This applies every `.sql` file in `drizzle/` in lexicographic order. The RLS policies and storage bucket policies are included — no manual SQL required.

> **Note:** `npm run db:migrate` runs the **custom migrator** in `scripts/db/migrate.ts`, not `drizzle-kit migrate`. Drizzle-kit's own migrator only applies entries listed in `drizzle/meta/_journal.json` (i.e. files it generated itself), and would silently skip the hand-written `0001`–`0004_*.sql` files. Always use `npm run db:migrate`.

### 4. Create storage bucket

In Supabase Dashboard → Storage, create a **private** bucket named `notes-files`. The storage policies in `drizzle/0003_storage_policies.sql` are applied by the migration, but the bucket itself must be created manually (Supabase does not support bucket creation via SQL migrations).

### 5. Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Seed data (optional)

```bash
npm run seed          # Small dev seed (~100 notes across 3 orgs)
npm run seed:large    # 10 000 notes across 10 orgs (search stress test)
```

The seed creates auth users, org memberships, notes with version history, shared files, and tag distributions designed to exercise every search path.

## Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Production build (runs TypeScript check) |
| `npm run start` | Start production server |
| `npm run typecheck` | TypeScript check without building |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a Drizzle migration from schema changes (writes a new `drizzle/<n>_<name>.sql` and updates `drizzle/meta/_journal.json`). Skip for tables that need RLS hardening — write the SQL by hand instead, matching the convention used by `0001`–`0004`. |
| `npm run db:migrate` | Custom runner (`scripts/db/migrate.ts`) — applies every `.sql` file under `drizzle/` in order. Use this, not `drizzle-kit migrate`, which would skip the hand-written files. |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `npm run seed` | Small dev seed |
| `npm run seed:large` | 10k-note seed |

## Deployment (Railway)

The app ships as a Docker container. `railway.toml` configures the build and deploy settings.

1. Push the repo to GitHub
2. Connect the repo to a Railway project
3. Add all environment variables from `.env.example` to the Railway service
4. Railway builds from the `Dockerfile` and deploys automatically on push to `main`
5. Set `NEXT_PUBLIC_APP_URL` to your Railway-generated domain

The `/healthz` endpoint returns `{"ok":true}` and is used by Railway's health check before traffic is routed to the new deployment.

## Key design decisions

**Why Supabase RLS instead of app-only checks?**
App-level permission checks can be bypassed by bugs, forgotten middleware, or direct API calls. RLS enforces tenant isolation and visibility at the database layer regardless of which code path reaches it. The two layers are complementary: app checks give good UX errors; RLS is the actual security boundary.

**Why keyset (cursor) pagination instead of offset?**
`OFFSET n` requires the database to scan and discard the first n rows on every request — O(n) work that grows with page number. Cursor pagination (`WHERE created_at < $cursor`) uses an index seek regardless of page depth, making page 1 and page 1000 equally fast.

**Why `SELECT FOR UPDATE` for versioning?**
Concurrent writes to the same note without a lock could produce duplicate version numbers via a read-modify-write race. `FOR UPDATE` serialises writers at the row level — all writes succeed and receive monotonically increasing versions. The overhead is acceptable because concurrent edits to the same note are rare.

**Why direct `public.users` insert in the seed instead of waiting for the trigger?**
The `on_auth_user_created` trigger mirrors auth users into `public.users` for the application path. In hosted Supabase, the auth service commits `auth.users` on its own connection; trigger propagation timing is not guaranteed to be visible to an external seed connection within any fixed window. The seed has superuser access (bypasses RLS) and knows all user data — inserting directly with `ON CONFLICT DO NOTHING` is deterministic and idempotent.
