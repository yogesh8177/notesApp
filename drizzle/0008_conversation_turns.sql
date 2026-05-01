CREATE TABLE IF NOT EXISTS "conversation_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "session_note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "turn_index" integer NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "note_refs" jsonb DEFAULT '[]',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "conversation_turns_session_idx"
  ON "conversation_turns" ("session_note_id");

CREATE UNIQUE INDEX "conversation_turns_session_turn_unique"
  ON "conversation_turns" ("session_note_id", "turn_index");

CREATE TABLE IF NOT EXISTS "conversation_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "session_note_id" uuid NOT NULL REFERENCES "notes"("id") ON DELETE CASCADE,
  "turn_start" integer NOT NULL,
  "turn_end" integer NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "conversation_summaries_session_idx"
  ON "conversation_summaries" ("session_note_id");

CREATE UNIQUE INDEX "conversation_summaries_session_window_unique"
  ON "conversation_summaries" ("session_note_id", "turn_end");
