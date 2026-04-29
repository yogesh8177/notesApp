-- Agent sessions: maps a (org, agent_id, repo, branch) tuple to the note that
-- holds that agent's session state. Used by the Claude Code hooks bridge in
-- .claude/hooks/* — bootstrap upserts a row here, checkpoint appends a
-- note_versions row to the referenced note.
--
-- Why a mapping table and not encoding identity in notes.title:
--   - title is human-facing and should remain editable; the lookup key must not be.
--   - keeping the key separate means we can rename the visible title without
--     breaking resume, and we get a real unique constraint instead of relying
--     on string format discipline.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  note_id      uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  agent_id     text NOT NULL,
  repo         text NOT NULL,
  branch       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_identity_unique
  ON agent_sessions (org_id, agent_id, repo, branch);

CREATE INDEX IF NOT EXISTS agent_sessions_note_idx
  ON agent_sessions (note_id);

-- RLS: agent_sessions is written/read only by the Bearer-token agent path,
-- which uses the service Drizzle client (bypasses RLS). We still enable RLS
-- and lock it down so a future Supabase-cookie codepath cannot accidentally
-- read or mutate session mappings.
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;

-- No policies = deny-all for non-superuser. The Drizzle service connection
-- in src/lib/db/client.ts uses the postgres role and bypasses RLS.
