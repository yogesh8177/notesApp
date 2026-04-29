-- Agent tokens: per-org Bearer tokens that authenticate the /agent/* and /mcp
-- routes. Replaces the env-based MEMORY_AGENT_TOKEN/MEMORY_AGENT_ORG_ID/
-- MEMORY_AGENT_USER_ID single-tenant model — env values still work as a
-- fallback for v0 deployments, but new tokens go here.
--
-- Token format: client receives `nat_<32 hex chars>`. Server stores only the
-- sha256 hash so a DB leak doesn't disclose live tokens. The first 8 chars of
-- the token (the prefix after `nat_`) are stored in clear so the UI can show
-- "nat_a1b2c3d4… last used 2h ago" without round-tripping the secret.
--
-- One token = one principal = one (org_id, user_id) tuple. user_id must be a
-- real org member; the application asserts membership on every call. Multiple
-- tokens can reference the same user (different machines, dev vs prod).

CREATE TABLE IF NOT EXISTS agent_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  token_prefix  text NOT NULL,
  token_hash    text NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_tokens_hash_unique
  ON agent_tokens (token_hash);

-- For "list active tokens in this org" queries.
CREATE INDEX IF NOT EXISTS agent_tokens_org_active_idx
  ON agent_tokens (org_id) WHERE revoked_at IS NULL;

-- Same RLS posture as agent_sessions: enabled with no policies. Reads and
-- writes go through the Drizzle service client behind app-level org checks.
-- A future RLS-aware refactor would add policies; documenting the deferral
-- in BUGS.md (same v2 fix-plan as the existing /agent/* RLS bypass).
ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
