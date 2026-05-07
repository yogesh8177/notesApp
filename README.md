# Collab Memory

[![CI](https://github.com/yogesh8177/notesApp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yogesh8177/notesApp/actions/workflows/ci.yml)

![CollabNotes hero infographic](./assets/infographic-79aa905e-01b1-425a-a5db-6b9921224540.png)

**Collab Memory** is a shared memory layer for human teams and AI agents. Every note, conversation, decision, and agent action lands in the same searchable, versioned, org-scoped workspace. Humans write notes; agents read context and checkpoint progress — and both show up in the same audit trail and graph.

The app is designed around one idea: **an AI agent should have the same persistent memory as a human teammate.** When a Claude Code session starts it resumes where it left off. When it commits it logs the work. When it searches it finds notes written by humans and agents alike. When it stops, the session is snapshotted as a versioned note for the next agent (or the same one) to pick up.

---

## Quick start

```bash
# 1. Configure environment variables
npx collab-memory setup

# 2. Wire Claude Code hooks + MCP into this project
npx collab-memory hooks-setup

# 3. Apply database migrations
npx collab-memory migrate

# 4. Start the dev server
npx collab-memory dev
```

| Command | What it does |
|---|---|
| `setup` | Interactive prompt for every `.env` variable — Supabase URLs, API keys, app URL |
| `hooks-setup` | Copies hook scripts to `.claude/hooks/`, writes `.claude/settings.json` and `.mcp.json`, prompts for agent token |
| `migrate` | Applies all SQL migrations in `drizzle/` including RLS policies and storage bucket policies |
| `dev` | Starts the Next.js dev server on `http://localhost:3000` |

> **Agent token:** after `dev` is running, sign in, open an org, go to **Org Settings → Agent Tokens → New token**. Paste the token when `hooks-setup` asks for it, or re-run `npx collab-memory hooks-setup` at any time.

---

## What it is

### For humans

- **Notes** — full CRUD with `private`, `org`, and `shared` visibility. Per-user share grants (`view` / `edit`). Tag attachment.
- **Versioning + diffs** — every write creates an immutable snapshot. History page shows who changed what and when with a line-level diff between any two versions.
- **Search** — full-text (`tsvector`), tag-prefix (`#tag` via `pg_trgm`), and filter browsing (author, date range, visibility). All paths enforce org boundaries.
- **File uploads** — signed upload URLs (bytes go browser → Supabase Storage, never through the app server). Up to 5 attachments per note.
- **AI summaries** — structured summaries streamed from Anthropic Claude (OpenAI fallback). User explicitly accepts before saving. Per-user rate limiting.
- **Audit log** — every auth event, mutation, AI call, agent action, permission denial, and failure is written to a persistent `audit_log` table.

### For AI agents

- **Session memory** — each Claude Code session bootstraps as a note in the org. On resume, the last checkpoint is injected as context before the model sees the first prompt.
- **Semantic recall** — on every user message, the recall hook searches the org's notes and injects the top matches as background context.
- **Automatic checkpointing** — on every `git commit`, on `PreCompact`, and on `SessionEnd`, the current work summary is appended to the session note as a new version.
- **Conversation turns** — the full turn-by-turn conversation history is stored with note references, searchable and linkable from the UI.
- **MCP server** — any MCP-aware client can read and write org notes through the model's tool-call interface. Every call is audited.

### For both

- **Graph explorer** — a Neo4j-backed relationship graph that maps how notes, users, agent sessions, conversation turns, tags, and audit events connect. Hover any timeline event or note card to see a preview. Click through to explore depth, expand neighbors, and navigate directly to the underlying data.

---

## How agent memory works

```
SessionStart  → bootstrap.js  → POST /agent/bootstrap
                                 ↳ creates or resumes session note
                                 ↳ injects last checkpoint + org guidelines as context

UserPromptSubmit → recall.js  → POST /agent/search
                                 ↳ full-text search across all org notes
                                 ↳ top-K hits injected as context before the model responds

PostToolUse (git commit) → checkpoint.js → POST /agent/sessions/:id/checkpoint
                                 ↳ accumulates done/decision/issue items in session state

PostToolUse (mcp__notes-app__*) → event.js → audit_log row (tool, duration, result)
SubagentStart / SubagentStop    ↗

PreCompact / SessionEnd → checkpoint.js → final snapshot written as a new note version
```

Each session is a note. Each checkpoint is a version. The full history of what an agent did, decided, and left unfinished is visible in the note's version history — readable by the next agent or any human teammate.

---

## Graph explorer

The graph feature requires a running Neo4j instance. It is fully optional — the app works without it.

```bash
# Start Neo4j (Docker)
docker run -d --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/yourpassword \
  neo4j:5

# Add to .env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=yourpassword

npm install
npm run graph:setup   # create constraints + indexes (once)
npm run graph:sync    # backfill existing data from Postgres
```

**Graph commands**

| Command | Description |
|---|---|
| `npm run graph:setup` | Create Neo4j uniqueness constraints and indexes (idempotent) |
| `npm run graph:sync` | Bulk-sync all notes, sessions, and audit events → Neo4j |
| `npm run graph:sync -- --org=<id>` | Sync a single org |
| `npm run graph:clear` | Delete all graph data (prompts for confirmation) |
| `npx collab-memory graph:setup` | Same as above via CLI |
| `npx collab-memory graph:sync` | Same as above via CLI |
| `npx collab-memory graph:clear` | Same as above via CLI |

**Graph nodes and relationships**

```
(User)-[:AUTHORED]->(Note)
(Note)-[:HAS_TAG]->(Tag)
(Note)-[:SHARED_WITH {permission}]->(User)
(AgentSession)-[:SESSION_FOR]->(Note)
(ConversationTurn)-[:TURN_IN]->(AgentSession)
(ConversationTurn)-[:REFERENCES]->(Note)      ← from noteRefs JSONB
(AuditEvent)-[:ACTED_ON]->(Note)
(User)-[:PERFORMED]->(AuditEvent)
```

Data is synced lazily on first graph request and can be backfilled in bulk with `graph:sync`. The graph page centers on the requested node after the force simulation settles. Clicking a node shows type-aware details and navigation links. Right-clicking expands its neighborhood inline. New nodes are highlighted with a yellow flash; the last-expanded node stays marked in cyan.

---

## MCP server

The `/mcp` endpoint is a stateless Streamable HTTP MCP server. Connect any MCP-aware client using a `MEMORY_AGENT_TOKEN`.

**Tools**

| Name | Purpose |
|---|---|
| `whoami` | Show the bound principal (org + user) |
| `search_notes` | Full-text + tag/author/date search |
| `list_recent_notes` | Cursor-paginated recency feed |
| `get_note` | Full content + version history + shares |
| `create_note` | Create a note as the bound principal |
| `update_note` | Replace note content (creates a version) |
| `append_to_note` | Append content (safe for concurrent writers) |
| `get_note_versions` | List version history for a note |
| `get_conversation` | Fetch conversation turns for a session note |
| `log_turn` | Write a conversation turn |
| `list_tags` | Discover available tags in the org |
| `get_org_timeline` | Recent audit events across the org |
| `list_agent_sessions` | Active agent sessions in the org |

**Resources**

| URI | Purpose |
|---|---|
| `notes://recent` | 50 most-recently-updated visible notes |
| `notes://note/{noteId}` | Single-note template |

**Connecting Claude Code**

```bash
claude mcp add --transport http notes-app https://your-app.example/mcp \
  --header "Authorization: Bearer $MEMORY_AGENT_TOKEN"
```

**Connecting Claude Desktop / other clients**

```json
{
  "mcpServers": {
    "notes-app": {
      "transport": { "type": "streamable-http", "url": "https://your-app.example/mcp" },
      "headers": { "Authorization": "Bearer YOUR_MEMORY_AGENT_TOKEN" }
    }
  }
}
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, React 19) |
| Language | TypeScript (strict) |
| Database | Supabase Postgres |
| Auth | Supabase Auth (magic link + password) |
| ORM | Drizzle ORM |
| Storage | Supabase Storage (private bucket, signed URLs) |
| Graph | Neo4j 5 (optional) + react-force-graph-2d |
| AI | Anthropic Claude (primary) + OpenAI (fallback) |
| Logging | Pino structured logs + persistent `audit_log` table |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) |
| Deployment | Docker + Railway |

---

## Architecture

### Security model

Two independent enforcement layers:

1. **App-level checks** — `requireOrgRole` on every org layout, `assertCanReadNote` / `assertCanWriteNote` / `assertCanShareNote` at every mutation. These produce good UX errors and early returns.
2. **Row-level security (RLS)** — Postgres policies in `drizzle/0002_rls_policies.sql` enforce tenant isolation at the database level regardless of which code path reaches them. The service-role client is used only where necessary: seed scripts, signed URL generation.

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

```
src/lib/
  auth/         ← session, org membership, permission helpers
  notes/        ← CRUD, versioning, sharing, diff
  search/       ← FTS, tag-prefix, filter-only browse
  files/        ← signed upload/download, permissions
  ai/           ← prompt construction, provider abstraction, rate limiting
  graph/        ← Neo4j client, sync service, neighborhood queries
  orgs/         ← org creation, invites, role management
  log/          ← pino logger + audit() writer
  db/           ← Drizzle client, schema definitions
  validation/   ← Result<T, E> envelope, zod helpers
```

---

## Local setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier is fine)
- Anthropic API key (OpenAI key optional — used as fallback)
- Neo4j 5 (optional — graph features disabled if `NEO4J_URI` is unset)

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

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API (secret) |
| `DATABASE_URL` | Supabase Dashboard → Project Settings → Database → Connection pooler (Transaction mode) |
| `DIRECT_URL` | Supabase Dashboard → Project Settings → Database → Direct connection |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `NEO4J_URI` | `bolt://localhost:7687` (optional) |
| `NEO4J_USER` | `neo4j` (optional) |
| `NEO4J_PASSWORD` | your password (optional) |

### 3. Run migrations

```bash
npm run db:migrate
```

Applies every `.sql` file in `drizzle/` in order, including RLS policies and storage bucket policies. Always use this, not `drizzle-kit migrate` — the kit's migrator skips hand-written SQL files not in its journal.

### 4. Create storage bucket

In Supabase Dashboard → Storage, create a **private** bucket named `notes-files`. The storage policies are applied by the migration but the bucket must be created manually.

### 5. Start the server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Seed data (optional)

```bash
npm run seed          # ~100 notes across 3 orgs
npm run seed:large    # 10 000 notes across 10 orgs (search stress test)
```

---

## Available scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run typecheck` | TypeScript check without building |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply all migrations (use this, not `drizzle-kit migrate`) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run seed` | Small dev seed |
| `npm run seed:large` | 10k-note seed |
| `npm run graph:setup` | Create Neo4j constraints + indexes |
| `npm run graph:sync` | Bulk sync Postgres → Neo4j |
| `npm run graph:clear` | Delete all graph data |
| `npm test` | Unit tests (Vitest, no DB) |
| `npm run test:integration` | Integration tests (requires `DATABASE_URL`) |
| `npm run test:e2e` | Playwright e2e tests (requires dev/prod server + Supabase) |
| `npm run test:e2e:ui` | Playwright interactive UI mode |
| `npm run test:e2e:headed` | Playwright with visible browser |

### Running tests

**Unit tests** — no external dependencies:
```bash
npm test
```

**Integration tests** — require a real Postgres database with migrations applied:
```bash
DATABASE_URL=postgresql://... npm run test:integration
```

**E2E tests (Playwright)** — require a running app and real Supabase credentials. The test runner auto-starts a dev server unless `PLAYWRIGHT_NO_SERVER=1` is set:
```bash
# Auto-starts dev server
npm run test:e2e

# If dev/prod server is already running on :3000
PLAYWRIGHT_NO_SERVER=1 npm run test:e2e
```

E2e tests provision and tear down their own isolated users and orgs via the Supabase Admin API. They cover auth flows, notes CRUD, cross-org access denial, and multi-browser session scenarios.

### Enabling e2e tests in CI

Add these secrets in GitHub → Settings → Secrets and variables → Actions → **Secrets**:

| Secret | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `DATABASE_URL` | Postgres connection string (pooler) |

Once the secrets are set, every push to `main` and every PR will run the full e2e suite.

---

## Agent session logging — setup guide

### How hooks work

```
.claude/hooks/
  _lib.js        ← shared helpers: state I/O, API client, git detection
  bootstrap.js   ← SessionStart: create/resume session note, inject checkpoint
  recall.js      ← UserPromptSubmit: search org notes, inject top-K as context
  checkpoint.js  ← PostToolUse (git commit), PreCompact, SessionEnd
  event.js       ← PostToolUse (MCP tools), SubagentStart, SubagentStop
  log.js         ← manual crediting utility for subagents
```

State is written relative to `__dirname` (the hooks directory), not `process.cwd()`. This ensures the state file stays in the main repo even when commands run from a worktree.

### Subagent self-reporting

`PostToolUse` hooks race on the state file when multiple subagents commit concurrently — some items are silently dropped. The fix is to have each subagent call `log.js` immediately after every commit.

```bash
node .claude/hooks/log.js done "<exact commit subject>"
```

`log.js` resolves the state file from the main repo via `git rev-parse --git-common-dir` so it works from any worktree. Duplicate calls are safe — dedup is automatic.

**Append to every subagent prompt:**

```
After every `git commit`, immediately run:
  node .claude/hooks/log.js done "<exact commit subject>"
Use the exact subject from the git output. Do this before moving on.
```

**Orchestrator logging:**

```bash
node .claude/hooks/log.js decision "Chose X over Y because Z"
node .claude/hooks/log.js issue "Race condition in upload handler"
```

### Reliability matrix

| Scenario | Auto via hook | Needs `log.js done` |
|---|---|---|
| Single agent, sequential commits | ✅ | No |
| Parallel subagents (any worktree) | Partial — race drops items | Yes |
| Decisions / issues | Never | Orchestrator logs manually |

---

## Deployment (Railway)

1. Push to GitHub and connect to a Railway project
2. Add all variables from `.env.example` to the Railway service
3. Railway builds from `Dockerfile` and deploys on push to `main`
4. Set `NEXT_PUBLIC_APP_URL` to your Railway domain

`GET /readyz` returns `{"ok":true}` — used by Railway's health check.

---

## Key design decisions

**Why Supabase RLS instead of app-only checks?**
App-level checks can be bypassed by bugs or forgotten middleware. RLS enforces tenant isolation at the database layer regardless of which code path reaches it. The two layers are complementary: app checks give good UX errors; RLS is the actual security boundary.

**Why keyset pagination instead of offset?**
`OFFSET n` requires the database to scan and discard n rows on every request. Cursor pagination uses an index seek — page 1 and page 1000 are equally fast.

**Why `SELECT FOR UPDATE` for versioning?**
Concurrent writes without a lock produce duplicate version numbers via a read-modify-write race. `FOR UPDATE` serialises writers at the row level — all writes succeed with monotonically increasing versions.

**Why lazy Neo4j sync instead of eager writes?**
Graph data is derived from Postgres — it is always recoverable via `graph:sync`. Writing to Neo4j on every mutation would couple the graph to the hot write path. Lazy sync on first graph request keeps mutations fast; the bulk backfill covers everything else.

**Why a separate graph store instead of recursive SQL CTEs?**
Multi-hop relationship traversal (2–4 hops across 6 node types) generates complex recursive queries that are hard to tune and harder to read. Neo4j's Cypher pattern matching expresses the same intent in one line and is natively optimised for graph traversal.
