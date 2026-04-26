# Module: deploy-ops

> Worktree branch: `agent/deploy-ops`
> Read root `CLAUDE.md` first.

## Scope

Production readiness: Dockerfile hardening, Railway service config, deeper
healthchecks, log shipping, env documentation, deploy runbook.

## Files you own

- `Dockerfile`, `.dockerignore`
- `railway.toml`
- `src/app/readyz/**` — DB-aware readiness probe.
- `docs/deployment.md` — runbook (you create this).
- Any log-forwarding hooks.

## Frozen — DO NOT MODIFY

- Application code under `src/lib/**` and `src/app/**` outside the readiness
  endpoint.
- `package.json` deps (unless adding a log shipper — get sign-off in NOTES).

## Required behavior

### Dockerfile (already in baseline)

- Verify image size < 250 MB compressed.
- Verify build is reproducible: `docker build .` twice produces identical
  digests.
- Verify non-root user.

### `/readyz`

- DB ping (`SELECT 1`).
- Supabase ping (auth, storage availability).
- Returns 200 only when all upstreams ok; 503 otherwise. Used by Railway's
  rolling-deploy gate.
- Audit failures via the structured logger (`log.warn`); do NOT call
  `audit()` for every poll.

### Railway

- Single service `web`.
- Env vars documented in `docs/deployment.md`:
  - DATABASE_URL, DIRECT_URL, NEXT_PUBLIC_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY
  - ANTHROPIC_API_KEY, OPENAI_API_KEY, ANTHROPIC_MODEL, OPENAI_MODEL
  - NEXT_PUBLIC_APP_URL = `https://<service>.up.railway.app`
- Healthcheck path `/healthz` (already configured).
- Restart policy `ON_FAILURE` w/ max 5 retries.

### Log shipping (optional, time-permitting)

- Logs go to stdout (pino JSON). Railway will collect.
- Optional: forward to Logtail/Better Stack via env var `LOG_DESTINATION=...`.

### Deploy runbook (`docs/deployment.md`)

- One-page guide: "create Railway project → connect GitHub → set env →
  deploy → run migrations → run seed".
- Include `railway run pnpm db:migrate` and `railway run pnpm seed:large`.

## Things to test

- `docker build .` succeeds locally.
- `docker run -p 3000:3000 --env-file .env <image>` boots; `/healthz` 200.
- After Railway deploy: `/healthz` 200, `/readyz` 200, sign-in flow works,
  protected routes redirect when unauth.

## Commit conventions

- `feat(ops): /readyz endpoint with DB + supabase ping`
- `chore(ops): docs/deployment.md runbook`
- `perf(ops): trim Docker image (drop dev deps from runner)`
- `feat(ops): optional log forwarder (gated on env)`
