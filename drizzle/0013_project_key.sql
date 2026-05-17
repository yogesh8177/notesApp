-- Project scoping: tag notes and audit events with the source repo so agent
-- recall/search/timeline can filter to "this project" without losing the
-- ability to look across all projects in the org.
--
-- Why a denormalized column (not a projects table):
--   - the only writer that knows the project today is the agent session
--     bootstrap, which already carries repo as a string; a join table would
--     add a write coordination point with no extra metadata to justify it.
--   - the column is nullable: web-UI notes and user-level memories stay
--     project-less and surface in every recall regardless of repo.
--
-- Why audit_log gets its own column (denormalized from notes):
--   - timeline queries are hot; joining audit_log → notes for filter on
--     every row would be wasteful.
--   - many audit rows have no noteId (search.execute, mcp.tool.*) — they
--     still need a project_key to be filterable.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS project_key text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS project_key text;

-- Backfill notes from agent_sessions: the only writer that has historically
-- known the repo for a note. Web-UI notes stay NULL.
UPDATE notes n
SET project_key = a.repo
FROM agent_sessions a
WHERE a.note_id = n.id
  AND n.project_key IS NULL;

-- Backfill audit_log from the source note. resource_id is text in this
-- schema, so cast notes.id to match.
UPDATE audit_log e
SET project_key = n.project_key
FROM notes n
WHERE e.resource_type = 'note'
  AND e.resource_id = n.id::text
  AND n.project_key IS NOT NULL
  AND e.project_key IS NULL;

CREATE INDEX IF NOT EXISTS notes_org_project_updated_idx
  ON notes (org_id, project_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_org_project_created_idx
  ON audit_log (org_id, project_key, created_at DESC);
