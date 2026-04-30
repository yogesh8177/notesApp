# LinkedIn posts — paste-ready

> Format: plain text, no markdown. LinkedIn strips it. Use line breaks
> liberally — first 2-3 lines must hook before the "see more" cut.
>
> Optimal length: 1300–2200 chars (LinkedIn rewards depth but caps reach
> beyond ~3000). Each post here is in that range.
>
> Replace [LINK] with the actual Medium article URL when published.

---

## Post 0 — Series intro

I built a multi-tenant full-stack app with 6 AI agents in 24 hours.

It went live with every database table world-readable for almost a day. I caught it during post-submission verification and fixed it.

That story is one of six in a new series I'm publishing.

The series is not "look what AI can do." It's a methodology for actually orchestrating agents on production code — the parts that worked, the parts that broke, and what review looked like when half the codebase was written by something that doesn't know what it doesn't know.

Six chapters:

1. The Setup — worktrees-per-module, frozen contracts, ownership matrices
2. The Prompts — what to tell the agent, what to keep on the human side
3. The Review — tiered review, the distrust map, the bugs caught pre-merge
4. The Hard Ones — bugs that slipped past review (RLS gap, audit gap, filter bypass) and how I found them
5. Instrumentation — logs vs. audit, and the failure modes specific to agent-generated observability
6. The Deploy — Docker + Railway + Supabase, the proxy header bug, the migration runbook gap

Honest writing. Real bugs. Commit SHAs in the source repo.

If you've used Claude or GPT for code generation and want to push past "auto-complete on steroids," this is the field guide.

Master article and chapter 1 (The Setup) live now: [LINK]

I'll post one chapter per day for the next six days.

#aiagents #softwareengineering #ai #engineeringleadership

---

## Post 1 — The Setup

Most "I built X with AI" workflows look like one chat window and a lot of copy-paste.

That's not orchestration. That's auto-complete with extra steps.

When I shipped the multi-tenant app, six agents worked in parallel on six git worktrees. Each owned a clearly scoped module. Each had a frozen-paths contract. None could see the others' diffs. Only I could merge.

That structure isn't fancy. It's three things:

1. Worktrees, not branches. Six independent working directories so agents never share a checkout. Standard git, no extra tooling.

2. A frozen-paths brief at the repo root that every agent reads first. Schema, RLS, auth helpers, validation envelope, audit writer — paths no module agent may touch. The brief explains WHY each path is frozen, so the agent has an operational interpretation, not just a rule.

3. An ownership matrix where two agents never own the same file. If two modules need to render on the same page, your decomposition is wrong. One owns the page; the other exposes a component.

The hardest part is honest scope. Six modules at 24 hours is aggressive but reviewable. Twelve modules would have buried me in diff review.

What this buys you: parallel agent work without coordination overhead. The orchestrator is the merge gate; everything else is async. The methodology breaks down somewhere around 8-10 simultaneous agents — the human review bandwidth caps out.

Chapter 1 of the series goes deep on the brief itself, the worktree topology, the per-module guide format, and the four ways scoping commonly fails (overlap, frozen paths that aren't actually frozen, too many modules, missing stop conditions).

Read it: [LINK]

#softwarearchitecture #aiagents #productivity

---

## Post 2 — The Prompts

A common mistake when starting agent-orchestrated builds: treating the prompt like the artefact.

It isn't. The prompt is the handle. The contract — CLAUDE.md plus the module guide plus the validation envelope — is the artefact.

A good module prompt has seven parts:

1. Identity (which module you are, what worktree you're in)
2. Read-first pointers (CLAUDE.md and your module guide)
3. Owned paths (what you may edit)
4. Frozen paths (what you must never touch)
5. Domain-specific don'ts (the failure modes you've seen before)
6. Acceptance criteria (how you know you're done)
7. Stop conditions (when to surface to the orchestrator)

What's NOT in the prompt:

— No code style preferences. The repo shows the style.
— No "be careful" or "think step by step." No-ops on capable models.
— No "you are an expert." Drop the filler.
— No "use TypeScript best practices." Practices without referents are noise.

The most valuable section is "what NOT to do." Specific, paste-able, learned. Examples from this build:

For the search agent: "Do not add an admin-bypass branch that returns sql\`true\`. Visibility is user-relative, not role-relative."

For the AI summary agent: "Do not concatenate user note content into the prompt as free text. Use a delimiter pattern."

For the org-admin agent: "Do not read the active_org_id cookie for any authorization decision."

These read like paranoid micromanagement until you realize each is a real failure mode I caught in earlier builds (or expected to catch in this one). Encoding the expectation in the prompt is cheaper than catching it in review.

Chapter 2 has the full per-module template you can lift wholesale, plus the module-specific don'ts for security-sensitive modules.

Read it: [LINK]

#promptengineering #aiagents #softwaredevelopment

---

## Post 3 — The Review

The single most important sentence in agent-orchestrated work:

The agent's job ends when its branch is on the orchestrator's screen. The orchestrator's job is the read.

I've seen good engineers spin up multi-agent setups and treat merge as a checkbox. They watch the agent run, see the tests pass, hit merge, move on. Then production pages them.

The methodology only works if review is real. Three tiers, decided BEFORE any agent runs:

DEEP REVIEW (read every line, walk every branch, write a smoke script):
— RLS policies
— Permission helpers
— Search query construction (every WHERE clause, the admin-cross-org case)
— AI prompt construction (no cross-tenant leakage)
— File upload path (signed URL only, no public bucket)
— Magic-link callback (open-redirect, code-replay)

SAMPLED REVIEW (spot-check 2-3 critical paths, scan diff for known-bad patterns):
— UI primitives (copied from a library)
— Stylesheet / layout chrome
— Seed factory output
— Health endpoint

TRUSTED (confirm intent from the diff, no further check):
— TypeScript / Tailwind / Next config
— Drizzle schema (mechanical translation of the data model)

Beyond the tiers, you maintain an explicit DISTRUST MAP — what classes of agent-generated code you specifically don't trust:

1. AI-generated SQL (missing JOINs, leaky subqueries)
2. AI-generated permission code (happy path correct, forbidden paths weak)
3. Edge-case error handling (4xx/5xx ignored)
4. Free-text concatenation into prompts (injection vector)

The bug is what the agent didn't write, not what it did. Read against that gap.

Real catch from this build: search agent wrote "if (isOrgAdmin) return sql\`true\`;" — meaning org admins could read every note in their org including private ones authored by others. Caught in deep review. Removed. Logged with commit SHA.

Chapter 3 has the full per-module review checklists.

Read it: [LINK]

#codereview #aiagents #software

---

## Post 4 — The Hard Ones

Honest chapter. The methodology cracked under load and I'm going to show you where.

Three classes of bugs escape even careful review:

1. Cross-component contract gaps
2. Type-declared-but-not-emitted gaps
3. Reality-vs-spec input gaps

All three are bugs in the NEGATIVE SPACE between correct components. Per-module review reads modules; these bugs live in the seams.

Real example, class 1:

I shipped this app with every database table world-readable for ~24 hours. Why? The repo has four migrations: 0000 (schema, drizzle-generated), 0001 (extensions), 0002 (RLS policies), 0003 (storage policies). drizzle-kit migrate applies only 0000. The custom npm run db:migrate applies all four. I had run drizzle-kit. I had not run the custom migrate.

Result: tables existed, but RLS was disabled on every public table. Combined with Supabase's default GRANTs to anon, the publicly-shipped anon key in the JS bundle could SELECT/INSERT/UPDATE/DELETE every row in every table.

The app worked because the Next.js layer uses superuser DB access (RLS bypass by design). Functional testing didn't notice. RLS-aware testing would have. I had none.

Caught during post-submission verification. Fixed in 15 minutes. Documented honestly in BUGS.md with the timeline.

Real example, class 2:

The audit module declared "permission.denied" as a valid AuditAction enum member. Suggested to a reviewer that denials persist in audit_log. They didn't. Zero callers in the entire codebase emitted audit({ action: "permission.denied", ... }). The type promised a behaviour the implementation didn't deliver. Caught when a user asked "don't we log such errors in the audit_logs table?" — fixed in four lines across permissions.ts and queries.ts.

Real example, class 3:

The notes filter form used HTML selects defaulting to "All authors", "All visibility", etc. The form submitted "" (empty string) for unset selects. The schema used z.string().uuid().optional() and z.enum([...]).optional() — both reject "". safeParse failed silently on every submission with any unset filter. The fallback ran. All notes returned regardless of selection. Caught only by clicking the actual UI.

The fix in all three classes is tests at the SEAMS, not at the unit:

— Cross-component: a smoke test that hits the boundary (anon-key REST call, asserting RLS denies)
— Type-declared-but-not-emitted: a contract test that exercises every union member
— Reality-vs-spec input: an interaction test producing real serialized input from the real source

Chapter 4 is the postmortem of all three with the actual diffs.

Read it: [LINK]

#engineeringculture #ai #softwarequality

---

## Post 5 — Instrumentation

When I ask an agent to "add logging," I usually get one of two things:

1. console.log scattered everywhere
2. log.info({ event: "..." }, "...") in the same places

Both look like coverage. Neither is observability.

LOGS and AUDIT are two different channels with two different jobs:

Structured logs:
— Lifetime: ephemeral (stdout → log shipper → days)
— Purpose: incident response. "What was the system doing in the 5 minutes before this 500?"
— Volume: high
— Cost per entry: cheap

Audit log:
— Lifetime: persistent (Postgres row, retained until deleted)
— Purpose: durable record of state changes. "When did user X join org Y?"
— Volume: lower (only state changes + security events)
— Searchability: SQL

Log lines are for debugging. Audit rows are for accountability.

Three failure modes specific to agent-generated instrumentation:

GAP 1: Visible-only logging. Agent ships console.log everywhere. Nothing persists, output is unstructured, impossible to filter usefully.

GAP 2: Structured-but-not-durable. Agent ships log.warn at events that should also persist. Stdout has the data; audit table doesn't. Three weeks later when someone asks "did user X access note Y?", the log streams have rolled over.

GAP 3: Type declared, never emitted. Agent declares a type union of valid audit actions including "permission.denied." No caller ever emits it. The type promises a behaviour the implementation doesn't deliver. Reviewer queries the audit table and finds nothing despite denials happening on every wrong-org URL paste.

This is the bug that bit me. The fix was four audit() calls. The lesson: when you declare a contract via types, write a test that asserts every member has an emitter.

What the operational SQL queries should look like:

— Recent activity per org (count audit_log group by org_id, action)
— Permission denials by user with threshold (security signal)
— AI summary failure rate (success/failure/fallback counts)
— File downloads per user (data exfil signal)

If you can write these queries against your audit table and they return useful results, your instrumentation is real. If you write them and the rows aren't there, you have the gap.

Chapter 5 covers the audit/log split, the structured logger gotchas (wrong call shape, logging whole objects, missing context propagation), and how to instrument an agent-built module from scratch.

Read it: [LINK]

#observability #softwareengineering #ai

---

## Post 6 — The Deploy

The deploy is where agent-generated code most predictably goes sideways.

Three reasons:
1. Deploy targets have implicit contracts (build-time vs runtime env, proxy headers, migration order) that aren't visible in the code.
2. Deploy issues are silent. Build succeeds, container starts, healthcheck passes — and the first user gets a wrong redirect.
3. The agent never sees the deploy. It writes the Dockerfile in a worktree; you're the only one who runs it on real infrastructure.

Real deploy bugs from this build:

The 0.0.0.0 redirect bug. Magic link login took users to https://0.0.0.0:8080. Cause: Next.js standalone listens on 0.0.0.0:8080 internally; Railway's proxy maps the public URL to that. request.nextUrl.origin reflected the internal address. Auth callback cloned it for redirects. Browser navigated to nowhere.

Fix: read x-forwarded-host and x-forwarded-proto headers Railway injects. Fall back to request.nextUrl.origin for local dev. Caught only by clicking the actual deployed magic link.

The NEXT_PUBLIC_* trap. Next.js inlines NEXT_PUBLIC_ vars into the client bundle at build time. Railway has separate "Build Variables" and runtime "Variables" panes. If you set them only as runtime vars, the bundle ships with undefined for all of them. Supabase client constructor gets undefined URL. Browser silently fails.

Fix: declare ARGs in the Dockerfile; set Build Variables on Railway. Verify by viewing source on the deployed page and grepping for "supabase.co" in the bundle.

The migration runbook gap. The repo has four migrations. drizzle-kit migrate applies one. The custom npm run db:migrate applies all four. The README said "run migrations" without flagging the distinction. Skipping the custom command leaves RLS off, search broken, storage policies missing.

Fix: explicit runbook with commands AND expected output. If the operator sees only "0000" in the migrate output, the runbook step has failed.

The minimum useful smoke tests post-deploy:

1. curl /healthz returns 200
2. Anon-key REST call against your tables returns []
3. View source of any page contains the right NEXT_PUBLIC_SUPABASE_URL
4. Magic link end-to-end (sign in, click email link, land on home)

Five seconds each. They would have caught every bug in this build except the 0.0.0.0 redirect (which the magic-link test does cover).

Chapter 6 has the full pre-deploy / Railway config / Supabase config / post-deploy checklist plus three patterns specific to grep-checking agent-built codebases before shipping (hardcoded localhost, service-role misuse, unbounded queries).

Read it: [LINK]

End of series. Thank you for reading. The unedited primary sources — BUGS.md, NOTES.md, REVIEW.md, AI_USAGE.md — are in the repo: github.com/yogesh8177/notesApp

#devops #aiagents #softwareengineering
